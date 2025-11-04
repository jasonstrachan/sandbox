const FRAME_UNIFORM_BYTE_SIZE = 64; // 16-byte aligned payload for WGSL uniform blocks
const BUFFER_USAGE = typeof GPUBufferUsage !== 'undefined'
  ? GPUBufferUsage
  : { UNIFORM: 0x10, COPY_DST: 0x20 };

export function createFrameUniforms(device, {
  gravity = [0, -981, 0],
  time = 0,
  deltaTime = 0,
  frame = 0,
} = {}) {
  if (!device) throw new Error('WebGPU device is required to create frame uniforms');

  const buffer = device.createBuffer({
    label: 'frame-uniforms',
    size: FRAME_UNIFORM_BYTE_SIZE,
    usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
    mappedAtCreation: false,
  });

  const data = new DataView(new ArrayBuffer(FRAME_UNIFORM_BYTE_SIZE));

  const write = () => {
    device.queue.writeBuffer(buffer, 0, data.buffer);
  };

  const setGravity = (value) => {
    const g = Array.isArray(value) ? value : [0, -981, 0];
    data.setFloat32(16, g[0] ?? 0, true);
    data.setFloat32(20, g[1] ?? 0, true);
    data.setFloat32(24, g[2] ?? 0, true);
    write();
  };

  const setFrameValues = ({ currentTime = time, currentDelta = deltaTime, frameIndex = frame } = {}) => {
    data.setFloat32(0, currentTime, true);
    data.setFloat32(4, currentDelta, true);
    data.setUint32(8, frameIndex >>> 0, true);
    data.setUint32(12, 0, true); // padding for alignment
    write();
  };

  // initialize defaults
  setGravity(gravity);
  setFrameValues({ currentTime: time, currentDelta: deltaTime, frameIndex: frame });

  return {
    buffer,
    size: FRAME_UNIFORM_BYTE_SIZE,
    updateFrame({ time: t, deltaTime: dt, frame: fi }) {
      setFrameValues({ currentTime: t ?? time, currentDelta: dt ?? deltaTime, frameIndex: fi ?? frame });
    },
    updateGravity(value) {
      setGravity(value);
    },
    dispose() {
      buffer.destroy?.();
    },
  };
}
