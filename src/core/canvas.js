const DEFAULT_BACKGROUND = '#05060a';

function getDevicePixelRatio() {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, 3);
}

export function createCanvasContext(canvas, { background = DEFAULT_BACKGROUND } = {}) {
  if (!canvas) throw new Error('Canvas element is required');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = getDevicePixelRatio();
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  resize();
  window.addEventListener('resize', resize);

  return {
    ctx,
    resize,
    destroy() {
      window.removeEventListener('resize', resize);
    },
  };
}

export function syncOverlayCanvas(targetCanvas, overlayCanvas) {
  const overlayCtx = overlayCanvas?.getContext?.('2d');
  if (!targetCanvas || !overlayCtx) return null;

  const resize = () => {
    const { width, height } = targetCanvas;
    overlayCanvas.width = width;
    overlayCanvas.height = height;
    overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    overlayCtx.clearRect(0, 0, width, height);
  };

  resize();
  window.addEventListener('resize', resize);

  return {
    ctx: overlayCtx,
    resize,
    clear() {
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    },
    destroy() {
      window.removeEventListener('resize', resize);
    },
  };
}

export function createWebGLContext(
  canvas,
  { contextId = 'webgl2', attributes = { preserveDrawingBuffer: true } } = {}
) {
  if (!canvas) throw new Error('Canvas element is required');
  const gl = canvas.getContext(contextId, attributes);
  if (!gl) throw new Error(`Unable to create ${contextId} context`);

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = getDevicePixelRatio();
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  resize();
  window.addEventListener('resize', resize);

  return {
    gl,
    resize,
    destroy() {
      window.removeEventListener('resize', resize);
    },
  };
}

export function createWebGPUContext(canvas) {
  if (!canvas) throw new Error('Canvas element is required');

  // Don't create a context yet - WebGPU needs async initialization
  // Just return a placeholder that will be configured later
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = getDevicePixelRatio();
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  resize();
  window.addEventListener('resize', resize);

  return {
    gpuContext: null, // Will be set by the prototype
    resize,
    destroy() {
      window.removeEventListener('resize', resize);
    },
  };
}
