import { createCanvasContext, createWebGLContext, createWebGPUContext, syncOverlayCanvas } from './canvas.js';
import { createRenderLoop } from './loop.js';
import { createControlPanel } from './controls.js';

const STORAGE_KEY = 'sandbox-active-prototype';

export function bootstrapPrototypeHost({
  canvas,
  overlay,
  picker,
  controlsRoot,
  metaRoot,
  prototypes,
}) {
  if (!canvas || !picker) throw new Error('canvas and picker are required');

  const controlPanel = createControlPanel(controlsRoot);
  let renderingContext = null;
  let overlayView = null;

  const env = {
    canvas,
    overlay,
    ctx: null,
    gl: null,
    gpuContext: null,
    overlayCtx: null,
    size: () => ({ width: canvas.width, height: canvas.height }),
    setBackground(color) {
      if (env.ctx) {
        env.ctx.fillStyle = color;
        env.ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (env.gl) {
        const gl = env.gl;
        const [r, g, b] = hexToRgb(color || '#000000');
        gl.clearColor(r / 255, g / 255, b / 255, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    },
    clearOverlay() {
      overlayView?.clear?.();
    },
  };

  function setupContext(kind = '2d') {
    renderingContext?.destroy?.();
    overlayView?.destroy?.();

    if (kind === 'webgpu') {
      renderingContext = createWebGPUContext(canvas);
      env.gpuContext = renderingContext.gpuContext;
      env.gl = null;
      env.ctx = null;
    } else if (kind.startsWith('webgl')) {
      renderingContext = createWebGLContext(canvas, { contextId: kind });
      env.gl = renderingContext.gl;
      env.ctx = null;
      env.gpuContext = null;
    } else {
      renderingContext = createCanvasContext(canvas);
      env.ctx = renderingContext.ctx;
      env.gl = null;
      env.gpuContext = null;
    }

    if (overlay) {
      overlayView = syncOverlayCanvas(canvas, overlay);
      env.overlayCtx = overlayView?.ctx ?? null;
    }
  }

  const loop = createRenderLoop(({ now, dt }) => {
    activePrototype?.update?.({ ctx: env.ctx, overlayCtx: env.overlayCtx, now, dt, env });
  });

  const pointerHandler = (event) => {
    if (event.cancelable) event.preventDefault();
    if (event.type === 'pointerdown') {
      canvas.setPointerCapture?.(event.pointerId);
    } else if (event.type === 'pointerup') {
      canvas.releasePointerCapture?.(event.pointerId);
    }
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    const data = {
      type: event.type,
      x: (event.clientX - rect.left) * dpr,
      y: (event.clientY - rect.top) * dpr,
      buttons: event.buttons,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    };
    activePrototype?.onPointer?.(data, env);
  };

  ['pointerdown', 'pointermove', 'pointerup'].forEach((type) => {
    canvas.addEventListener(type, pointerHandler);
  });

  let activePrototype = null;

  function loadPrototype(id) {
    const def = prototypes.find((proto) => proto.id === id) || prototypes[0];
    if (!def) return;

    if (activePrototype?.destroy) {
      activePrototype.destroy();
    }

    setupContext(def.context || '2d');

    env.clearOverlay();
    env.setBackground(def.background || '#05060a');

    picker.value = def.id;
    updateMeta(metaRoot, def);

    const controls = def.controls ?? [];
    controlPanel.mount(controls, (key, value) => {
      activePrototype?.onControlChange?.(key, value, env);
    });

    const instance = def.create(env);
    activePrototype = instance;

    if (!loopStarted) {
      loop.start();
      loopStarted = true;
    }

    safeStorage('setItem', STORAGE_KEY, def.id);
  }

  let loopStarted = false;

  picker.innerHTML = prototypes
    .map((proto) => `<option value="${proto.id}">${proto.title}</option>`)
    .join('');

  picker.addEventListener('change', (event) => {
    loadPrototype(event.target.value);
  });

  const initialId = safeStorage('getItem', STORAGE_KEY) || prototypes[0]?.id;
  if (initialId) loadPrototype(initialId);

  return {
    loadPrototype,
    destroy() {
      loop.stop();
      ['pointerdown', 'pointermove', 'pointerup'].forEach((type) => {
        canvas.removeEventListener(type, pointerHandler);
      });
      activePrototype?.destroy?.();
      renderingContext?.destroy?.();
      overlayView?.destroy?.();
    },
  };
}

function hexToRgb(hex) {
  const sanitized = hex.replace('#', '');
  if (sanitized.length === 3) {
    return sanitized
      .split('')
      .map((char) => parseInt(char + char, 16));
  }
  const int = parseInt(sanitized, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function safeStorage(method, key, value) {
  try {
    if (method === 'getItem') return window?.localStorage?.getItem(key) ?? null;
    if (method === 'setItem') window?.localStorage?.setItem(key, value);
  } catch (_) {
    return null;
  }
  return null;
}

function updateMeta(metaRoot, def) {
  if (!metaRoot) return;
  metaRoot.innerHTML = '';

  const title = document.createElement('h2');
  title.textContent = def.title;
  metaRoot.appendChild(title);

  if (def.description) {
    const p = document.createElement('p');
    p.textContent = def.description;
    metaRoot.appendChild(p);
  }

  if (def.tags?.length) {
    const list = document.createElement('ul');
    list.className = 'tag-list';
    def.tags.forEach((tag) => {
      const li = document.createElement('li');
      li.textContent = tag;
      list.appendChild(li);
    });
    metaRoot.appendChild(list);
  }
}
