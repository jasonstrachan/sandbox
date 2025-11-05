/**
 * WebGPU helper utilities
 */

export async function initWebGPU(canvas) {
  if (!navigator.gpu) {
    throw new Error('WebGPU not supported in this browser');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('No WebGPU adapter found');
  }

  const device = await adapter.requestDevice();

  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  return { adapter, device, context, format };
}

export function createBuffer(device, data, usage) {
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage,
    mappedAtCreation: true,
  });

  if (data instanceof Float32Array) {
    new Float32Array(buffer.getMappedRange()).set(data);
  } else if (data instanceof Uint32Array) {
    new Uint32Array(buffer.getMappedRange()).set(data);
  } else if (data instanceof Uint16Array) {
    new Uint16Array(buffer.getMappedRange()).set(data);
  } else {
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data));
  }

  buffer.unmap();
  return buffer;
}

export function createStorageBuffer(device, size, usage = GPUBufferUsage.STORAGE) {
  return device.createBuffer({
    size,
    usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
}

export function createUniformBuffer(device, size) {
  return device.createBuffer({
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

export function updateUniformBuffer(device, buffer, data) {
  device.queue.writeBuffer(buffer, 0, data);
}

export function createShaderModule(device, code) {
  return device.createShaderModule({ code });
}

export function createComputePipeline(device, shader, entryPoint, bindGroupLayouts) {
  return device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts }),
    compute: {
      module: shader,
      entryPoint,
    },
  });
}

export function createRenderPipeline(device, {
  vertexShader,
  fragmentShader,
  format,
  bufferLayouts = [],
  bindGroupLayouts = [],
  topology = 'triangle-list',
  depthTest = false,
}) {
  const pipelineDesc = {
    layout: device.createPipelineLayout({ bindGroupLayouts }),
    vertex: {
      module: vertexShader,
      entryPoint: 'main',
      buffers: bufferLayouts,
    },
    fragment: {
      module: fragmentShader,
      entryPoint: 'main',
      targets: [{ format }],
    },
    primitive: {
      topology,
      cullMode: 'none',
    },
  };

  if (depthTest) {
    pipelineDesc.depthStencil = {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus',
    };
  }

  return device.createRenderPipeline(pipelineDesc);
}

export function createTexture(device, { width, height, format, usage }) {
  return device.createTexture({
    size: { width, height },
    format,
    usage,
  });
}

export function createBindGroup(device, layout, entries) {
  return device.createBindGroup({
    layout,
    entries,
  });
}

export function dispatchCompute(device, computePipeline, bindGroup, workgroupCount) {
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginComputePass();

  passEncoder.setPipeline(computePipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.dispatchWorkgroups(...workgroupCount);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
}
