/**
 * @param {GPUDevice} device
 * @param {(encoder: GPUCommandEncoder) => void} callback
 * @param {{ label?: string }} [options]
 */
export function submitEncoder(device, callback, { label } = {}) {
  if (!device) throw new Error('WebGPU device is required to submit encoders');
  if (typeof callback !== 'function') throw new Error('submitEncoder callback must be a function');

  const encoder = device.createCommandEncoder(label ? { label } : {});
  callback(encoder);
  const commandBuffer = encoder.finish();
  device.queue.submit([commandBuffer]);
  return commandBuffer;
}
