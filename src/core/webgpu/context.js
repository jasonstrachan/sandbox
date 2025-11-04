import { getDevicePixelRatio } from '../canvas.js';
import { createFrameUniforms } from './frame-uniforms.js';

const DEFAULT_OPTIONAL_FEATURES = ['timestamp-query', 'texture-compression-bc', 'shader-f16'];

export async function createWebGPUContext(
  canvas,
  {
    requiredFeatures = [],
    optionalFeatures = DEFAULT_OPTIONAL_FEATURES,
    requiredLimits = {},
    adapterOptions = { powerPreference: 'high-performance' },
  } = {}
) {
  if (!canvas) throw new Error('Canvas element is required for WebGPU context');
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error('WebGPU is not available in this environment');
  }

  const adapter = await navigator.gpu.requestAdapter(adapterOptions);
  if (!adapter) throw new Error('Unable to acquire a WebGPU adapter');

  const adapterFeatures = adapter.features ? Array.from(adapter.features) : [];
  const missingRequired = requiredFeatures.filter((feature) => !adapterFeatures.includes(feature));
  if (missingRequired.length) {
    throw new Error(`Adapter is missing required features: ${missingRequired.join(', ')}`);
  }

  const filteredOptional = optionalFeatures.filter((feature) => adapterFeatures.includes(feature));

  const device = await adapter.requestDevice({
    requiredFeatures,
    optionalFeatures: filteredOptional,
    requiredLimits,
  });

  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Unable to acquire WebGPU rendering context');

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  const configure = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = getDevicePixelRatio();
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.configure({
      device,
      format: presentationFormat,
      alphaMode: 'premultiplied',
    });
  };

  configure();
  const hasWindow = typeof window !== 'undefined';
  if (hasWindow) {
    window.addEventListener('resize', configure);
  }

  const frameUniforms = createFrameUniforms(device);

  device.lost?.then((info) => {
    console.warn('WebGPU device lost', info?.message || info); // eslint-disable-line no-console
  });

  return {
    type: 'webgpu',
    adapter,
    device,
    queue: device.queue,
    context,
    presentationFormat,
    supportedFeatures: adapterFeatures,
    frameUniforms,
    resize: configure,
    destroy() {
      frameUniforms?.dispose?.();
      if (hasWindow) {
        window.removeEventListener('resize', configure);
      }
      context.unconfigure?.();
    },
  };
}
