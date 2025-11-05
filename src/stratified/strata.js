import { DECAY_SHADER, STAMP_SHADER, AGE_SHADER } from './wgsl/strata.js';

/** @typedef {{ format: GPUTextureFormat, sampleTexture: GPUTexture, workTexture: GPUTexture, sampleView: GPUTextureView, workView: GPUTextureView }} ChannelTarget */

const ACCUM_SIZE = 512;
const STRATA_UNIFORM_SIZE = 64;
const CONTACT_COUNT_OFFSET = 32;
const CONTACT_CAPACITY = 8192;
const CHANNELS = {
  pigment: { format: 'rgba16float', label: 'pigment' },
  thickness: { format: 'r16float', label: 'thickness' },
  shear: { format: 'rg16float', label: 'shear' },
};

export function createStrataAccumulator(env) {
  const webgpu = env?.webgpu;
  if (!webgpu) throw new Error('WebGPU context required for strata accumulator');
  const { device } = webgpu;
  const MAP_MODE_READ = typeof GPUMapMode !== 'undefined' ? GPUMapMode.READ : 1;

  const paramsBuffer = device.createBuffer({
    label: 'stratified-strata-params',
    size: STRATA_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const sampler = device.createSampler({
    label: 'stratified-strata-sampler',
    minFilter: 'linear',
    magFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });
  const paramsBufferStorage = new ArrayBuffer(STRATA_UNIFORM_SIZE);
  const paramsFloat = new Float32Array(paramsBufferStorage);
  const paramsUint = new Uint32Array(paramsBufferStorage);
  const zeroCount = new Uint32Array([0]);

  function createAccumTexture(label, format = 'rgba16float') {
    return device.createTexture({
      label,
      size: { width: ACCUM_SIZE, height: ACCUM_SIZE, depthOrArrayLayers: 1 },
      mipLevelCount: 1,
      sampleCount: 1,
      dimension: '2d',
      format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST,
    });
  }

  function createChannelTargets(key) {
    const { format, label } = CHANNELS[key];
    const sampleTexture = createAccumTexture(`stratified-${label}-accum`, format);
    const workTexture = createAccumTexture(`stratified-${label}-work`, format);
    return {
      format,
      sampleTexture,
      workTexture,
      sampleView: sampleTexture.createView(),
      workView: workTexture.createView(),
    };
  }

  /** @type {Record<string, ChannelTarget>} */
  const channelTargets = {};
  Object.keys(CHANNELS).forEach((key) => {
    channelTargets[key] = createChannelTargets(key);
  });

  const pigmentTarget = channelTargets.pigment;
  const thicknessTarget = channelTargets.thickness;
  const shearTarget = channelTargets.shear;
  const renderChannels = [pigmentTarget, thicknessTarget, shearTarget];
  const contactReadbacks = [createContactReadback('A'), createContactReadback('B')];
  const pendingContactReadbacks = [];
  let lastContactCount = 0;

  const decayModule = device.createShaderModule({
    label: 'stratified-strata-decay-shader',
    code: DECAY_SHADER,
  });
  const stampModule = device.createShaderModule({
    label: 'stratified-strata-stamp-shader',
    code: STAMP_SHADER,
  });
  const ageModule = device.createShaderModule({
    label: 'stratified-strata-age-shader',
    code: AGE_SHADER,
  });

  const decayLayout = device.createBindGroupLayout({
    label: 'stratified-strata-decay-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });

  const stampLayout = device.createBindGroupLayout({
    label: 'stratified-strata-stamp-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const decayPipeline = device.createRenderPipeline({
    label: 'stratified-strata-decay-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [decayLayout] }),
    vertex: { module: decayModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: decayModule,
      entryPoint: 'fs_decay',
      targets: [{
        format: pigmentTarget.format,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const stampPipeline = device.createRenderPipeline({
    label: 'stratified-strata-stamp-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [stampLayout] }),
    vertex: { module: stampModule, entryPoint: 'vs_stamp' },
    fragment: {
      module: stampModule,
      entryPoint: 'fs_stamp',
      targets: renderChannels.map((target) => ({
        format: target.format,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        },
      })),
    },
    primitive: { topology: 'triangle-list' },
  });

  const thicknessAgePipeline = device.createRenderPipeline({
    label: 'stratified-strata-age-thickness-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [decayLayout] }),
    vertex: { module: ageModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: ageModule,
      entryPoint: 'fs_age_thickness',
      targets: [{
        format: thicknessTarget.format,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const shearAgePipeline = device.createRenderPipeline({
    label: 'stratified-strata-age-shear-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [decayLayout] }),
    vertex: { module: ageModule, entryPoint: 'vs_fullscreen' },
    fragment: {
      module: ageModule,
      entryPoint: 'fs_age_shear',
      targets: [{
        format: shearTarget.format,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });

  let stampBindGroup = null;
  let lastDataBuffer = null;

  /**
   * @param {{ data?: GPUBuffer }} [buffers]
   */
  function bindContacts(buffers) {
    const data = buffers?.data;
    if (!data) {
      stampBindGroup = null;
      lastDataBuffer = null;
      return;
    }
    if (data === lastDataBuffer && stampBindGroup) {
      return;
    }
    stampBindGroup = device.createBindGroup({
      label: 'stratified-strata-stamp-bind-group',
      layout: stampLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: data } },
      ],
    });
    lastDataBuffer = data;
  }

  function accumulate({
    contactBuffers,
    extent = 1.3,
    pointSize = 2.5,
    intensity = 0.02,
    decay = 0.985,
    time = 0,
  }) {
    bindContacts(contactBuffers);
    paramsFloat[0] = ACCUM_SIZE;
    paramsFloat[1] = ACCUM_SIZE;
    paramsFloat[2] = extent * 2;
    paramsFloat[3] = extent * 2;
    paramsFloat[4] = pointSize;
    paramsFloat[5] = intensity;
    paramsFloat[6] = decay;
    paramsFloat[7] = time;
    paramsUint[8] = 0;
    paramsUint[9] = CONTACT_CAPACITY;
    paramsUint[10] = 0;
    paramsUint[11] = 0;
    device.queue.writeBuffer(paramsBuffer, 0, paramsBufferStorage);

    const decayBindGroup = device.createBindGroup({
      label: 'stratified-strata-decay-bind-group',
      layout: decayLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: pigmentTarget.sampleView },
      ],
    });

    const encoder = device.createCommandEncoder({ label: 'stratified-strata-encoder' });
    let contactReadbackSlot = null;
    if (contactBuffers?.state) {
      encoder.copyBufferToBuffer(contactBuffers.state, 0, paramsBuffer, CONTACT_COUNT_OFFSET, 4);
      contactReadbackSlot = contactReadbacks.find((slot) => !slot.pending);
      if (contactReadbackSlot) {
        encoder.copyBufferToBuffer(contactBuffers.state, 0, contactReadbackSlot.buffer, 0, 4);
        contactReadbackSlot.pending = true;
        pendingContactReadbacks.push(contactReadbackSlot);
      }
    } else {
      device.queue.writeBuffer(paramsBuffer, CONTACT_COUNT_OFFSET, zeroCount);
    }

    const copyExtent = { width: ACCUM_SIZE, height: ACCUM_SIZE, depthOrArrayLayers: 1 };

    const runAgePass = (pipeline, target, label) => {
      const ageBindGroup = device.createBindGroup({
        label,
        layout: decayLayout,
        entries: [
          { binding: 0, resource: { buffer: paramsBuffer } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: target.sampleView },
        ],
      });
      const pass = encoder.beginRenderPass({
        label,
        colorAttachments: [
          {
            view: target.workView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, ageBindGroup);
      pass.draw(6);
      pass.end();
      encoder.copyTextureToTexture(
        { texture: target.workTexture },
        { texture: target.sampleTexture },
        copyExtent
      );
    };

    runAgePass(thicknessAgePipeline, thicknessTarget, 'stratified-thickness-age');
    runAgePass(shearAgePipeline, shearTarget, 'stratified-shear-age');

    const decayPass = encoder.beginRenderPass({
      label: 'stratified-strata-decay-pass',
      colorAttachments: [
        {
          view: pigmentTarget.workView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    decayPass.setPipeline(decayPipeline);
    decayPass.setBindGroup(0, decayBindGroup);
    decayPass.draw(6);
    decayPass.end();

    if (stampBindGroup) {
      encoder.copyTextureToTexture(
        { texture: thicknessTarget.sampleTexture },
        { texture: thicknessTarget.workTexture },
        copyExtent
      );
      encoder.copyTextureToTexture(
        { texture: shearTarget.sampleTexture },
        { texture: shearTarget.workTexture },
        copyExtent
      );

      const stampPass = encoder.beginRenderPass({
        label: 'stratified-strata-stamp-pass',
        colorAttachments: renderChannels.map((target) => ({
          view: target.workView,
          loadOp: 'load',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        })),
      });
      stampPass.setPipeline(stampPipeline);
      stampPass.setBindGroup(0, stampBindGroup);
      stampPass.draw(6, CONTACT_CAPACITY);
      stampPass.end();
    }

    const targetsToUpdate = stampBindGroup ? renderChannels : [pigmentTarget];
    for (const target of targetsToUpdate) {
      encoder.copyTextureToTexture(
        { texture: target.workTexture },
        { texture: target.sampleTexture },
        copyExtent
      );
    }

    device.queue.submit([encoder.finish()]);
    if (pendingContactReadbacks.length) {
      for (const slot of pendingContactReadbacks.splice(0, pendingContactReadbacks.length)) {
        startContactReadback(slot);
      }
    }
  }

  function startContactReadback(slot) {
    slot.buffer.mapAsync(MAP_MODE_READ, 0, 4).then(() => {
      const copy = slot.buffer.getMappedRange(0, 4).slice(0);
      slot.buffer.unmap();
      const value = new Uint32Array(copy)[0];
      lastContactCount = Math.min(value, CONTACT_CAPACITY);
      slot.pending = false;
    }).catch(() => {
      slot.pending = false;
      try {
        slot.buffer.unmap();
      } catch {
        /* ignore */
      }
    });
  }

  function createContactReadback(label) {
    return {
      label,
      buffer: device.createBuffer({ label: `stratified-contact-readback-${label}`, size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
      pending: false,
    };
  }

  function clear() {
    const encoder = device.createCommandEncoder({ label: 'stratified-strata-clear-encoder' });
    for (const target of Object.values(channelTargets)) {
      const clearSample = encoder.beginRenderPass({
        label: `${target.format}-strata-clear-sample`,
        colorAttachments: [
          {
            view: target.sampleView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      clearSample.end();
      const clearWork = encoder.beginRenderPass({
        label: `${target.format}-strata-clear-work`,
        colorAttachments: [
          {
            view: target.workView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      clearWork.end();
    }
    device.queue.submit([encoder.finish()]);
  }

  function getTextureView(channel = 'pigment') {
    return channelTargets[channel]?.sampleView ?? pigmentTarget.sampleView;
  }

  function getTextureViews() {
    return Object.fromEntries(
      Object.entries(channelTargets).map(([key, target]) => [key, target.sampleView])
    );
  }

  function getTextureInfo() {
    return Object.fromEntries(
      Object.entries(channelTargets).map(([key, target]) => [key, {
        width: ACCUM_SIZE,
        height: ACCUM_SIZE,
        format: target.format,
        sampler: 'linear-clamp',
      }])
    );
  }

  function destroy() {
    Object.values(channelTargets).forEach((target) => {
      target.sampleTexture.destroy();
      target.workTexture.destroy();
    });
    paramsBuffer.destroy();
  }

  return {
    accumulate,
    bindContacts,
    getTextureView,
    getTextureViews,
    getTextureInfo,
    getLastContactCount: () => lastContactCount,
    clear,
    destroy,
  };
}
