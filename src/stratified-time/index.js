/**
 * Stratified Time - Sprint 1 Prototype
 * An art piece visualizing the deceleration of consumption through
 * falling, deforming objects that compact into geological strata
 */

import { initWebGPU, createBuffer, createUniformBuffer, updateUniformBuffer, createShaderModule, createComputePipeline, createRenderPipeline } from '../utils/webgpu-helpers.js';
import { SeededRandom } from '../utils/seeded-random.js';
import { createArtifact, ObjectClass } from './object-factory.js';
import {
  PHYSICS_COMPUTE_SHADER,
  OBJECT_VERTEX_SHADER,
  OBJECT_FRAGMENT_SHADER,
  STRATA_FRAGMENT_SHADER,
  FULLSCREEN_VERTEX_SHADER,
} from './shaders.js';

export const stratifiedTime = {
  id: 'stratified-time',
  title: 'Stratified Time',
  description: 'Objects fall, deform, and compact into geological layers - a meditation on consumption and decay.',
  tags: ['webgpu', 'physics', 'generative', 'art'],
  background: '#0a0b0f',
  context: 'webgpu',

  controls: [
    { key: 'seed', label: 'Seed', type: 'text', value: 'stratified-2024' },
    { key: 'gravity', label: 'Gravity', type: 'range', min: 100, max: 2000, step: 50, value: 981 },
    { key: 'spawnRate', label: 'Spawn Rate', type: 'range', min: 0.1, max: 5, step: 0.1, value: 1 },
    { key: 'maxObjects', label: 'Max Objects', type: 'range', min: 10, max: 200, step: 10, value: 50 },
    { key: 'pause', label: 'Pause', type: 'checkbox', value: false },
  ],

  create(env) {
    const canvas = env.canvas;
    let gpu = null;
    let objects = [];
    let time = 0;
    let spawnTimer = 0;
    let frameCount = 0;

    const state = {
      seed: 'stratified-2024',
      gravity: 981,
      spawnRate: 1,
      maxObjects: 50,
      pause: false,
    };

    const DT_SIM = 1 / 120; // Fixed timestep
    const GROUND_LEVEL = 0;

    // Initialize WebGPU
    let initialized = false;

    async function init() {
      try {
        gpu = await initWebGPU(canvas);
        await setupPipelines();
        initialized = true;
      } catch (err) {
        console.error('WebGPU initialization failed:', err);
        // Render fallback message
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1b2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ff6b6b';
        ctx.font = '16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('WebGPU not supported', canvas.width / 2, canvas.height / 2 - 20);
        ctx.fillStyle = '#a0a0a0';
        ctx.font = '12px monospace';
        ctx.fillText('Try Chrome/Edge 113+ or Safari TP', canvas.width / 2, canvas.height / 2 + 10);
      }
    }

    let computePipeline, renderPipeline, strataRenderPipeline;
    let uniformBuffer, objectUniformBuffer;
    let bindGroupLayout, computeBindGroupLayout;
    let particleBuffer;
    let strataTexture, strataSampler;

    async function setupPipelines() {
      const { device, format } = gpu;

      // Create shaders
      const physicsShader = createShaderModule(device, PHYSICS_COMPUTE_SHADER);
      const objectVertexShader = createShaderModule(device, OBJECT_VERTEX_SHADER);
      const objectFragmentShader = createShaderModule(device, OBJECT_FRAGMENT_SHADER);
      const fullscreenVertexShader = createShaderModule(device, FULLSCREEN_VERTEX_SHADER);
      const strataFragmentShader = createShaderModule(device, STRATA_FRAGMENT_SHADER);

      // Create uniform buffers
      uniformBuffer = createUniformBuffer(device, 256); // View-projection + time
      objectUniformBuffer = createUniformBuffer(device, 256); // Per-object data

      // Create particle buffer (for compute)
      const maxParticles = state.maxObjects;
      particleBuffer = device.createBuffer({
        size: maxParticles * 32, // Each particle: 3 pos + 3 vel + 1 mass + 1 settled = 8 floats
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });

      // Create strata accumulation texture
      strataTexture = device.createTexture({
        size: { width: 512, height: 512 },
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
      });

      strataSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
      });

      // Create bind group layouts
      computeBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ],
      });

      bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        ],
      });

      const strataBindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        ],
      });

      // Create pipelines
      computePipeline = createComputePipeline(device, physicsShader, 'main', [computeBindGroupLayout]);

      renderPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: {
          module: objectVertexShader,
          entryPoint: 'main',
          buffers: [
            {
              arrayStride: 12,
              attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
            },
          ],
        },
        fragment: {
          module: objectFragmentShader,
          entryPoint: 'main',
          targets: [{ format }],
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: 'back',
        },
        depthStencil: {
          depthWriteEnabled: true,
          depthCompare: 'less',
          format: 'depth24plus',
        },
      });
    }

    function spawnObject() {
      if (objects.length >= state.maxObjects) {
        // Remove oldest settled object
        const settledIndex = objects.findIndex(obj => obj.settled);
        if (settledIndex >= 0) {
          objects.splice(settledIndex, 1);
        } else {
          return; // Can't spawn
        }
      }

      const seedStr = `${state.seed}-${frameCount}`;
      const artifact = createArtifact(seedStr);

      const obj = {
        artifact,
        position: { x: artifact.spawnX, y: artifact.spawnY, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        rotation: artifact.rotation,
        angularVel: artifact.angularVel,
        settled: false,
        vertexBuffer: null,
        indexBuffer: null,
        vertexCount: artifact.mesh.indices.length,
      };

      // Create GPU buffers for this object
      if (gpu) {
        obj.vertexBuffer = createBuffer(
          gpu.device,
          artifact.mesh.positions,
          GPUBufferUsage.VERTEX
        );
        obj.indexBuffer = createBuffer(
          gpu.device,
          artifact.mesh.indices,
          GPUBufferUsage.INDEX
        );
      }

      objects.push(obj);
    }

    function simulatePhysics(dt) {
      for (const obj of objects) {
        if (obj.settled) continue;

        // Apply gravity
        obj.velocity.y -= state.gravity * dt;

        // Apply damping
        obj.velocity.x *= 0.98;
        obj.velocity.y *= 0.98;
        obj.velocity.z *= 0.98;

        // Update position
        obj.position.x += obj.velocity.x * dt;
        obj.position.y += obj.velocity.y * dt;
        obj.position.z += obj.velocity.z * dt;

        // Update rotation
        obj.rotation += obj.angularVel * dt;

        // Ground collision
        if (obj.position.y <= GROUND_LEVEL + 2) {
          obj.position.y = GROUND_LEVEL + 2;
          obj.velocity.y *= -0.3; // Bounce

          // Settle if slow
          const speed = Math.sqrt(
            obj.velocity.x ** 2 + obj.velocity.y ** 2 + obj.velocity.z ** 2
          );

          if (speed < 5) {
            obj.velocity.x = 0;
            obj.velocity.y = 0;
            obj.velocity.z = 0;
            obj.angularVel *= 0.5;

            if (speed < 1) {
              obj.settled = true;
            }
          }
        }
      }
    }

    function createViewProjectionMatrix(width, height) {
      // Simple orthographic projection
      const aspect = width / height;
      const viewHeight = 80; // cm
      const viewWidth = viewHeight * aspect;

      // Camera looks at the strata from the side
      const near = -100;
      const far = 100;

      const left = -viewWidth / 2;
      const right = viewWidth / 2;
      const bottom = -10;
      const top = viewHeight - 10;

      return new Float32Array([
        2 / (right - left), 0, 0, 0,
        0, 2 / (top - bottom), 0, 0,
        0, 0, -2 / (far - near), 0,
        -(right + left) / (right - left),
        -(top + bottom) / (top - bottom),
        -(far + near) / (far - near),
        1,
      ]);
    }

    function render() {
      if (!gpu || !initialized) return;

      const { device, context, format } = gpu;
      const { width, height } = env.size();

      // Create depth texture
      const depthTexture = device.createTexture({
        size: { width, height },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });

      const commandEncoder = device.createCommandEncoder();

      // Update uniforms
      const viewProjection = createViewProjectionMatrix(width, height);
      const uniformData = new Float32Array(64);
      uniformData.set(viewProjection, 0);
      uniformData[16] = time; // time
      updateUniformBuffer(device, uniformBuffer, uniformData);

      // Begin render pass
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.04, g: 0.05, b: 0.08, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });

      renderPass.setPipeline(renderPipeline);

      // Render each object
      for (const obj of objects) {
        if (!obj.vertexBuffer || !obj.indexBuffer) continue;

        // Create bind group for this object
        const objectData = new Float32Array(16);
        objectData[0] = obj.position.x;
        objectData[1] = obj.position.y;
        objectData[2] = obj.position.z;
        objectData[3] = obj.rotation;
        objectData[4] = 1.0; // scale.x
        objectData[5] = 1.0; // scale.y
        objectData[6] = 1.0; // scale.z

        // Convert HSL to RGB for color
        const { h, s, l } = obj.artifact.color;
        const rgb = hslToRgb(h / 360, s, l);
        objectData[8] = rgb[0];
        objectData[9] = rgb[1];
        objectData[10] = rgb[2];

        updateUniformBuffer(device, objectUniformBuffer, objectData);

        const bindGroup = device.createBindGroup({
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: { buffer: objectUniformBuffer } },
          ],
        });

        renderPass.setBindGroup(0, bindGroup);
        renderPass.setVertexBuffer(0, obj.vertexBuffer);
        renderPass.setIndexBuffer(obj.indexBuffer, 'uint32');
        renderPass.drawIndexed(obj.vertexCount);
      }

      renderPass.end();

      device.queue.submit([commandEncoder.finish()]);

      // Cleanup
      depthTexture.destroy();
    }

    function update({ now, dt }) {
      if (!initialized) return;
      if (state.pause) return;

      time = now * 0.001;
      frameCount++;

      // Spawn objects
      spawnTimer += dt;
      const spawnInterval = 1 / state.spawnRate;
      if (spawnTimer >= spawnInterval) {
        spawnTimer = 0;
        spawnObject();
      }

      // Fixed timestep simulation
      simulatePhysics(DT_SIM);

      // Render
      render();
    }

    function onControlChange(key, value) {
      state[key] = value;
    }

    function destroy() {
      // Cleanup GPU resources
      if (gpu) {
        for (const obj of objects) {
          obj.vertexBuffer?.destroy();
          obj.indexBuffer?.destroy();
        }
        uniformBuffer?.destroy();
        objectUniformBuffer?.destroy();
        particleBuffer?.destroy();
        strataTexture?.destroy();
      }
      objects = [];
    }

    // Helper: HSL to RGB conversion
    function hslToRgb(h, s, l) {
      let r, g, b;

      if (s === 0) {
        r = g = b = l;
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
      }

      return [r, g, b];
    }

    // Initialize
    init();

    return {
      update,
      onControlChange,
      destroy,
    };
  },
};
