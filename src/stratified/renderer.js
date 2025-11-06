import { STRATIFIED_SHADER, GROUND_SHADER } from './wgsl/renderer.js';
import { UPSCALE_SHADER } from './wgsl/upscale.js';
import { DITHER_SHADER, MAX_DITHER_WIDTH } from './wgsl/dither.js';
import { rendererBindGroupEntries, sceneShaderHeader } from './wgsl/shared.js';
import { hashString } from '../utils/hash.js';

const BILLBOARD_SHADER = /* wgsl */ `
${sceneShaderHeader()}

struct QuadVertexIn {
  @location(0) quadPos : vec2f,
  @location(1) center : vec4f,
};

struct QuadVertexOut {
  @builtin(position) position : vec4f,
  @location(0) localOffset : vec2f,
};

fn isoProject(pos : vec3f) -> vec2f {
  let isoX = (pos.x - pos.z) * 0.70710678;
  let isoY = pos.y * -0.9 + (pos.x + pos.z) * 0.35;
  return vec2f(isoX, isoY);
}

@vertex
fn vs_billboard(input : QuadVertexIn) -> QuadVertexOut {
  var out : QuadVertexOut;
  let isoScale = scene.viewB.x;
  let resolution = scene.viewA.xy;
  let center = isoProject(input.center.xyz) * isoScale + scene.viewA.zw;
  let pixelRadius = max(input.center.w * isoScale, 0.5);
  let offset = input.quadPos * pixelRadius;
  let ndcX = ((center.x + offset.x) / resolution.x) * 2.0 - 1.0;
  let ndcY = 1.0 - ((center.y + offset.y) / resolution.y) * 2.0;
  out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
  out.localOffset = input.quadPos;
  return out;
}

@fragment
fn fs_billboard(input : QuadVertexOut) -> @location(0) vec4f {
  let dist = length(input.localOffset);
  if (dist > 1.0) {
    discard;
  }
  let baseColor = scene.palette1.xyz;
  let highlight = scene.palette0.xyz;
  let col = mix(baseColor, highlight, 0.35);
  let alpha = clamp(1.0 - dist, 0.0, 1.0);
  return vec4f(col, alpha);
}
`;

const SCENE_UNIFORM_SIZE = 128;
const GROUND_RESOLUTION = 64;
const GROUND_EXTENT = 0.65;
const PIXEL_TEXTURE_FORMAT = 'rgba16float';
const DITHER_UNIFORM_SIZE = 32;
const DITHER_ERROR_CAPACITY = MAX_DITHER_WIDTH * 2 * 16;

export function createStratifiedRenderer(env) {
  const webgpu = env?.webgpu;
  if (!webgpu) throw new Error('WebGPU context is required for the Stratified renderer');

  const { device, context, presentationFormat, frameUniforms } = webgpu;
  const sceneUniformBuffer = device.createBuffer({
    label: 'stratified-scene-uniforms',
    size: SCENE_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const strataSampler = device.createSampler({
    label: 'stratified-strata-sampler',
    minFilter: 'linear',
    magFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  const pixelSampler = device.createSampler({
    label: 'stratified-pixel-sampler',
    minFilter: 'nearest',
    magFilter: 'nearest',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  const ditherParamsStorage = new ArrayBuffer(DITHER_UNIFORM_SIZE);
  const ditherParamsFloat = new Float32Array(ditherParamsStorage);
  const ditherParamsUint = new Uint32Array(ditherParamsStorage);
  const ditherParamsBuffer = device.createBuffer({
    label: 'stratified-dither-params',
    size: DITHER_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const ditherErrorBuffer = device.createBuffer({
    label: 'stratified-dither-errors',
    size: DITHER_ERROR_CAPACITY,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  function createFallbackTexture(label, format) {
    return device.createTexture({
      label,
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  const fallbackTextures = {
    pigment: createFallbackTexture('stratified-strata-fallback-pigment', 'rgba16float'),
    thickness: createFallbackTexture('stratified-strata-fallback-thickness', 'r16float'),
    shear: createFallbackTexture('stratified-strata-fallback-shear', 'rg16float'),
  };

  function zeroTexture(texture) {
    const zeroRow = new Uint8Array(256);
    device.queue.writeTexture(
      { texture },
      zeroRow,
      { bytesPerRow: 256 },
      { width: 1, height: 1, depthOrArrayLayers: 1 }
    );
  }

  Object.values(fallbackTextures).forEach(zeroTexture);

  const fallbackViews = {
    pigment: fallbackTextures.pigment.createView(),
    thickness: fallbackTextures.thickness.createView(),
    shear: fallbackTextures.shear.createView(),
  };

  const groundGeometry = buildGroundGeometry(GROUND_RESOLUTION, GROUND_EXTENT);
  const groundVertexBuffer = device.createBuffer({
    label: 'stratified-ground-vertices',
    size: groundGeometry.positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(groundVertexBuffer, 0, groundGeometry.positions);

  const groundIndexBuffer = device.createBuffer({
    label: 'stratified-ground-indices',
    size: groundGeometry.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(groundIndexBuffer, 0, groundGeometry.indices);
  const groundIndexCount = groundGeometry.indices.length;

  const shaderModule = device.createShaderModule({
    label: 'stratified-preview-shader',
    code: STRATIFIED_SHADER,
  });

  const groundShaderModule = device.createShaderModule({
    label: 'stratified-ground-shader',
    code: GROUND_SHADER,
  });

  const shaderManifest = [
    { label: 'preview', hash: hashString(STRATIFIED_SHADER), codeSize: STRATIFIED_SHADER.length },
    { label: 'ground', hash: hashString(GROUND_SHADER), codeSize: GROUND_SHADER.length },
  ];

  const bindGroupLayout = device.createBindGroupLayout({
    label: 'stratified-bind-group-layout',
    entries: rendererBindGroupEntries(),
  });

  const pipeline = device.createRenderPipeline({
    label: 'stratified-preview-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 16,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [
        {
          format: PIXEL_TEXTURE_FORMAT,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back',
    },
  });

  const groundPipeline = device.createRenderPipeline({
    label: 'stratified-ground-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: groundShaderModule,
      entryPoint: 'vs_ground',
      buffers: [
        {
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        },
      ],
    },
    fragment: {
      module: groundShaderModule,
      entryPoint: 'fs_ground',
      targets: [
        {
          format: PIXEL_TEXTURE_FORMAT,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none',
    },
  });

  const billboardShaderModule = device.createShaderModule({
    label: 'stratified-billboard-shader',
    code: BILLBOARD_SHADER,
  });

  const billboardQuadData = new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    -1, 1,
    1, -1,
    1, 1,
  ]);
  const billboardQuadBuffer = device.createBuffer({
    label: 'stratified-billboard-quad',
    size: billboardQuadData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(billboardQuadBuffer.getMappedRange()).set(billboardQuadData);
  billboardQuadBuffer.unmap();

  let billboardInstanceBuffer = null;
  let billboardInstanceCapacity = 0;
  let billboardInstanceCount = 0;

  const billboardPipeline = device.createRenderPipeline({
    label: 'stratified-billboard-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: billboardShaderModule,
      entryPoint: 'vs_billboard',
      buffers: [
        {
          arrayStride: 8,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        },
        {
          arrayStride: 16,
          stepMode: 'instance',
          attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }],
        },
      ],
    },
    fragment: {
      module: billboardShaderModule,
      entryPoint: 'fs_billboard',
      targets: [
        {
          format: PIXEL_TEXTURE_FORMAT,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  });

  const upscaleModule = device.createShaderModule({
    label: 'stratified-upscale-shader',
    code: UPSCALE_SHADER,
  });

  const upscaleBindGroupLayout = device.createBindGroupLayout({
    label: 'stratified-upscale-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });

  const upscalePipeline = device.createRenderPipeline({
    label: 'stratified-upscale-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [upscaleBindGroupLayout] }),
    vertex: { module: upscaleModule, entryPoint: 'vs_upscale' },
    fragment: {
      module: upscaleModule,
      entryPoint: 'fs_upscale',
      targets: [{ format: presentationFormat }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  });

  const ditherModule = device.createShaderModule({
    label: 'stratified-dither-shader',
    code: DITHER_SHADER,
  });

  const ditherBindGroupLayout = device.createBindGroupLayout({
    label: 'stratified-dither-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: PIXEL_TEXTURE_FORMAT, viewDimension: '2d' },
      },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });

  const ditherPipeline = device.createComputePipeline({
    label: 'stratified-dither-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [ditherBindGroupLayout] }),
    compute: { module: ditherModule, entryPoint: 'cs_dither' },
  });

  let strataViews = { ...fallbackViews };
  let bindGroup = null;
  let pixelTarget = null;
  let ditherTarget = null;
  let ditherBindGroup = null;
  let upscaleBindGroup = null;
  let upscaleSourceView = null;
  let pixelSettings = { width: 1, height: 1 };
  let ditherState = { enabled: false, strength: 0.75, levels: 18, serpentine: true };

  function refreshBindGroup() {
    bindGroup = device.createBindGroup({
      label: 'stratified-bind-group',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: frameUniforms.buffer } },
        { binding: 1, resource: { buffer: sceneUniformBuffer } },
        { binding: 2, resource: strataSampler },
        { binding: 3, resource: strataViews.pigment },
        { binding: 4, resource: strataViews.thickness },
        { binding: 5, resource: strataViews.shear },
      ],
    });
  }

  refreshBindGroup();

  function createPixelTarget(width, height) {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const texture = device.createTexture({
      label: 'stratified-pixel-target',
      format: PIXEL_TEXTURE_FORMAT,
      size: { width: safeWidth, height: safeHeight, depthOrArrayLayers: 1 },
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const view = texture.createView();
    return { width: safeWidth, height: safeHeight, texture, view };
  }

  function createDitherTarget(width, height) {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const texture = device.createTexture({
      label: 'stratified-dither-target',
      format: PIXEL_TEXTURE_FORMAT,
      size: { width: safeWidth, height: safeHeight, depthOrArrayLayers: 1 },
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    return { width: safeWidth, height: safeHeight, texture, view: texture.createView() };
  }

  function ensureDitherBindGroup() {
    if (!pixelTarget || !ditherTarget) return;
    ditherBindGroup = device.createBindGroup({
      label: 'stratified-dither-bind-group',
      layout: ditherBindGroupLayout,
      entries: [
        { binding: 0, resource: pixelTarget.view },
        { binding: 1, resource: ditherTarget.view },
        { binding: 2, resource: { buffer: ditherErrorBuffer } },
        { binding: 3, resource: { buffer: ditherParamsBuffer } },
      ],
    });
  }

  function ensureUpscaleBindGroup(sourceView) {
    if (!sourceView) return;
    if (upscaleBindGroup && upscaleSourceView === sourceView) {
      return;
    }
    upscaleSourceView = sourceView;
    upscaleBindGroup = device.createBindGroup({
      label: 'stratified-upscale-bind-group',
      layout: upscaleBindGroupLayout,
      entries: [
        { binding: 0, resource: pixelSampler },
        { binding: 1, resource: sourceView },
      ],
    });
  }

  function setPixelTargetSize(width, height) {
    const targetWidth = Math.max(1, Math.floor(width || 1));
    const targetHeight = Math.max(1, Math.floor(height || 1));
    if (pixelTarget && pixelTarget.width === targetWidth && pixelTarget.height === targetHeight) {
      return;
    }
    if (pixelTarget) {
      pixelTarget.texture.destroy();
    }
    pixelTarget = createPixelTarget(targetWidth, targetHeight);
    pixelSettings = { width: targetWidth, height: targetHeight };
    if (ditherTarget) {
      ditherTarget.texture.destroy();
    }
    ditherTarget = createDitherTarget(targetWidth, targetHeight);
    ditherBindGroup = null;
    upscaleBindGroup = null;
    ensureDitherBindGroup();
    updateDitherParams();
  }

  let vertexBuffer = null;
  let indexBuffer = null;
  let indexCount = 0;

  function setGeometryBuffers({ vertex, index, count }) {
    vertexBuffer = vertex;
    indexBuffer = index;
    indexCount = count ?? 0;
  }

  function ensureBillboardBuffer(byteSize) {
    if (billboardInstanceBuffer && billboardInstanceCapacity >= byteSize) {
      return;
    }
    billboardInstanceBuffer?.destroy?.();
    billboardInstanceBuffer = device.createBuffer({
      label: 'stratified-billboard-instances',
      size: byteSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    billboardInstanceCapacity = byteSize;
  }

  function setBillboardInstances(instances = []) {
    if (!Array.isArray(instances) || instances.length === 0) {
      billboardInstanceCount = 0;
      return;
    }
    const count = Math.min(instances.length, 2048);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      const entry = instances[i] || {};
      data[i * 4 + 0] = entry.x ?? 0;
      data[i * 4 + 1] = entry.y ?? 0;
      data[i * 4 + 2] = entry.z ?? 0;
      data[i * 4 + 3] = Math.max(0.001, entry.r ?? 0.03);
    }
    const byteSize = data.byteLength;
    ensureBillboardBuffer(byteSize);
    device.queue.writeBuffer(billboardInstanceBuffer, 0, data.buffer, data.byteOffset, data.byteLength);
    billboardInstanceCount = count;
  }

  function setStrataTextures(views = {}) {
    const nextViews = {
      pigment: views.pigment ?? fallbackViews.pigment,
      thickness: views.thickness ?? fallbackViews.thickness,
      shear: views.shear ?? fallbackViews.shear,
    };
    const changed =
      nextViews.pigment !== strataViews.pigment ||
      nextViews.thickness !== strataViews.thickness ||
      nextViews.shear !== strataViews.shear;
    if (!changed) return;
    strataViews = nextViews;
    refreshBindGroup();
  }

  function setStrataTexture(view) {
    setStrataTextures({ pigment: view });
  }

  function updateDitherParams() {
    if (!pixelTarget) return;
    ditherParamsUint[0] = pixelTarget.width;
    ditherParamsUint[1] = pixelTarget.height;
    ditherParamsFloat[2] = ditherState.levels;
    ditherParamsFloat[3] = ditherState.strength;
    ditherParamsUint[4] = ditherState.serpentine ? 1 : 0;
    device.queue.writeBuffer(ditherParamsBuffer, 0, ditherParamsStorage);
  }

  function setDitherOptions(options = {}) {
    ditherState = {
      ...ditherState,
      ...options,
    };
    updateDitherParams();
  }

  function updateSceneUniforms({
    width,
    height,
    centerX,
    centerY,
    scale,
    groundHeight,
    groundAmp,
    groundFreq,
    groundColor = [0.2, 0.24, 0.28, 0.65],
    debugMode = 0,
    debugParam = 0,
    pixelSnap = false,
    palette,
  }) {
    const p = palette || {
      primary: [0.2, 0.2, 0.2, 1],
      secondary: [0.9, 0.7, 0.6, 1],
      shadow: [0.1, 0.1, 0.12, 1],
      sediment: [0.4, 0.32, 0.28, 1],
    };
    const data = new Float32Array([
      width,
      height,
      centerX,
      centerY,
      scale,
      groundHeight,
      groundAmp,
      groundFreq,
      groundColor[0] ?? 0.2,
      groundColor[1] ?? 0.24,
      groundColor[2] ?? 0.28,
      groundColor[3] ?? 0.65,
      debugMode,
      debugParam,
      pixelSnap ? 1 : 0,
      0,
      ...(p.primary ?? [0, 0, 0, 1]),
      ...(p.secondary ?? [1, 1, 1, 1]),
      ...(p.shadow ?? [0, 0, 0, 1]),
      ...(p.sediment ?? [0.4, 0.3, 0.2, 1]),
    ]);
    device.queue.writeBuffer(sceneUniformBuffer, 0, data.buffer, data.byteOffset, data.byteLength);
  }

  /**
   * @param {{ clearColor?: string, showGround?: boolean, skipArtifacts?: boolean, drawBillboards?: boolean }} [options]
   */
  function render({ clearColor, showGround = true, skipArtifacts = false, drawBillboards = false } = {}) {
    const hasGround = showGround && groundIndexCount > 0;
    const hasArtifacts = !skipArtifacts && Boolean(vertexBuffer && indexBuffer && indexCount > 0);
    const hasBillboards = drawBillboards && billboardInstanceCount > 0;
    if (!hasGround && !hasArtifacts && !hasBillboards) return;
    if (!pixelTarget) {
      setPixelTargetSize(env.canvas?.width ?? 1, env.canvas?.height ?? 1);
    }
    const encoder = device.createCommandEncoder({ label: 'stratified-frame-encoder' });
    const swapchainTexture = context.getCurrentTexture();
    const swapchainView = swapchainTexture.createView();
    const targetView = pixelTarget?.view ?? swapchainView;
    const clearValue = parseColor(clearColor || '#05060a');
    const pass = encoder.beginRenderPass({
      label: 'stratified-render-pass',
      colorAttachments: [
        {
          view: targetView,
          clearValue,
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    if (hasGround) {
      pass.setPipeline(groundPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, groundVertexBuffer);
      pass.setIndexBuffer(groundIndexBuffer, 'uint32');
      pass.drawIndexed(groundIndexCount);
    }

    if (hasArtifacts) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.setIndexBuffer(indexBuffer, 'uint32');
      pass.drawIndexed(indexCount);
    }
    if (hasBillboards) {
      pass.setPipeline(billboardPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, billboardQuadBuffer);
      pass.setVertexBuffer(1, billboardInstanceBuffer);
      pass.draw(6, billboardInstanceCount);
    }
    pass.end();

    let upscaleSource = targetView;
    if (ditherState.enabled && pixelTarget && ditherTarget) {
      ensureDitherBindGroup();
      updateDitherParams();
      const ditherPass = encoder.beginComputePass({ label: 'stratified-dither-pass' });
      ditherPass.setPipeline(ditherPipeline);
      ditherPass.setBindGroup(0, ditherBindGroup);
      ditherPass.dispatchWorkgroups(1);
      ditherPass.end();
      upscaleSource = ditherTarget.view;
    }

    if (pixelTarget) {
      ensureUpscaleBindGroup(upscaleSource);
      if (!upscaleBindGroup) {
        device.queue.submit([encoder.finish()]);
        return;
      }
      const upscalePass = encoder.beginRenderPass({
        label: 'stratified-upscale-pass',
        colorAttachments: [
          {
            view: swapchainView,
            clearValue,
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      upscalePass.setPipeline(upscalePipeline);
      upscalePass.setBindGroup(0, upscaleBindGroup);
      upscalePass.draw(6);
      upscalePass.end();
    }

    device.queue.submit([encoder.finish()]);
  }

  function destroy() {
    vertexBuffer?.destroy?.();
    indexBuffer?.destroy?.();
    groundVertexBuffer?.destroy?.();
    groundIndexBuffer?.destroy?.();
    billboardInstanceBuffer?.destroy?.();
    billboardQuadBuffer.destroy();
    sceneUniformBuffer.destroy();
    Object.values(fallbackTextures).forEach((texture) => texture.destroy());
    pixelTarget?.texture?.destroy?.();
    ditherTarget?.texture?.destroy?.();
    ditherParamsBuffer.destroy();
    ditherErrorBuffer.destroy();
  }

  return {
    setGeometryBuffers,
    setStrataTextures,
    setStrataTexture,
    updateSceneUniforms,
    render,
    setPixelResolution: setPixelTargetSize,
    getPixelResolution: () => ({ ...pixelSettings }),
    setDitherOptions,
    setBillboardInstances,
    getShaderManifest() {
      return shaderManifest.map((entry) => ({ ...entry }));
    },
    destroy,
  };
}

function parseColor(hex) {
  const normalized = typeof hex === 'string' ? hex.replace('#', '') : '000000';
  const value = Number.parseInt(normalized.length === 3 ? normalized.repeat(2) : normalized, 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  return { r, g, b, a: 1 };
}

function buildGroundGeometry(resolution = 32, extent = 2) {
  const vertsPerSide = resolution + 1;
  const vertexCount = vertsPerSide * vertsPerSide;
  const positions = new Float32Array(vertexCount * 3);
  for (let z = 0; z <= resolution; z += 1) {
    for (let x = 0; x <= resolution; x += 1) {
      const idx = z * vertsPerSide + x;
      const u = (x / resolution - 0.5) * 2 * extent;
      const v = (z / resolution - 0.5) * 2 * extent;
      positions[idx * 3] = u;
      positions[idx * 3 + 1] = 0;
      positions[idx * 3 + 2] = v;
    }
  }

  const quadCount = resolution * resolution;
  const indices = new Uint32Array(quadCount * 6);
  let ptr = 0;
  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const topLeft = z * vertsPerSide + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + vertsPerSide;
      const bottomRight = bottomLeft + 1;
      indices[ptr + 0] = topLeft;
      indices[ptr + 1] = bottomLeft;
      indices[ptr + 2] = topRight;
      indices[ptr + 3] = topRight;
      indices[ptr + 4] = bottomLeft;
      indices[ptr + 5] = bottomRight;
      ptr += 6;
    }
  }

  return { positions, indices };
}
