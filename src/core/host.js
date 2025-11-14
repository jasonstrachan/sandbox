import { createCanvasContext, createWebGLContext, syncOverlayCanvas } from './canvas.js';
import { createRenderLoop } from './loop.js';
import { createControlPanel } from './controls.js';
import { createCanvasFrame } from './frame.js';
import { createToggleBar } from './toggles.js';

const STORAGE_KEY = 'sandbox-active-prototype';
const CONTROL_STORAGE_PREFIX = 'sandbox-controls:';
const TOGGLE_STORAGE_PREFIX = 'sandbox-toggles:';

export function bootstrapPrototypeHost({
  canvas,
  overlay,
  picker,
  controlsRoot,
  metaRoot,
  togglesRoot,
  prototypes,
}) {
  if (!canvas || !picker) throw new Error('canvas and picker are required');

  const controlPanel = createControlPanel(controlsRoot);
  const togglePanel = createToggleBar(togglesRoot);
  let renderingContext = null;
  let overlayView = null;
  const frame = createCanvasFrame(canvas);
  const failedContexts = new Set();
  const toggleState = new Map();
  const controlStateCache = new Map();
  const togglePrefCache = new Map();
  let paused = false;
  let pausedTimestamp = null;
  let activePrototypeId = null;

  const env = {
    canvas,
    overlay,
    ctx: null,
    gl: null,
    overlayCtx: null,
    size: () => ({ width: canvas.width, height: canvas.height }),
    frame,
    worldToCanvas: frame.worldToCanvas,
    canvasToWorld: frame.canvasToWorld,
    isPaused: () => paused,
    getToggleState(key) {
      return toggleState.get(key) ?? false;
    },
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

    try {
      if (kind.startsWith('webgl')) {
        renderingContext = createWebGLContext(canvas, { contextId: kind });
        env.gl = renderingContext.gl;
        env.ctx = null;
      } else {
        renderingContext = createCanvasContext(canvas);
        env.ctx = renderingContext.ctx;
        env.gl = null;
      }
    } catch (error) {
      renderingContext = null;
      env.ctx = null;
      env.gl = null;
      env.overlayCtx = null;
      throw error;
    }

    if (overlay) {
      overlayView = syncOverlayCanvas(canvas, overlay);
      env.overlayCtx = overlayView?.ctx ?? null;
    }
  }

  const loop = createRenderLoop(({ now, dt }) => {
    if (paused) {
      if (pausedTimestamp === null) pausedTimestamp = now;
      activePrototype?.update?.({ ctx: env.ctx, overlayCtx: env.overlayCtx, now: pausedTimestamp, dt: 0, env });
      return;
    }
    pausedTimestamp = null;
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

  function disablePrototypeOption(id) {
    if (!picker) return;
    const option = picker.querySelector(`option[value="${id}"]`);
    if (!option) return;
    if (!option.dataset.originalLabel) {
      option.dataset.originalLabel = option.textContent;
    }
    option.disabled = true;
    if (!option.textContent.includes(' (unavailable)')) {
      option.textContent = `${option.dataset.originalLabel} (unavailable)`;
    }
  }

  function loadPrototype(id, options = {}) {
    const { allowFallback = true, forceRetry = false } = options;
    const def = prototypes.find((proto) => proto.id === id) || prototypes[0];
    if (!def) return;
    if (failedContexts.has(def.id) && !forceRetry) {
      console.warn(`Prototype "${def.title}" is disabled (context unavailable).`);
      return;
    }

    if (activePrototype?.destroy) {
      activePrototype.destroy();
    }
    let contextError = null;
    try {
      setupContext(def.context || '2d');
    } catch (error) {
      contextError = error;
    }
    if (contextError) {
      console.warn(`Failed to initialize ${def.context || '2d'} context for "${def.title}"`, contextError);
      if (def.context?.startsWith('webgl') && allowFallback) {
        failedContexts.add(def.id);
        disablePrototypeOption(def.id);
        const fallback = prototypes.find((proto) => !proto.context || !proto.context.startsWith('webgl'));
        if (fallback && fallback.id !== def.id) {
          console.warn(`Falling back to canvas prototype "${fallback.title}"`);
          loadPrototype(fallback.id, { allowFallback: false });
          return;
        }
      }
      return;
    }

    env.clearOverlay();
    env.setBackground(def.background || '#05060a');

    picker.value = def.id;
    updateMeta(metaRoot, def);

    const savedControls = loadControlState(def.id);
    const savedToggles = loadToggleState(def.id);

    initializeToggles(def.toggles ?? [], savedToggles);

    const controls = def.controls ?? [];
    controlPanel.mount(controls, (key, value) => {
      persistControlValue(def.id, key, value);
      activePrototype?.onControlChange?.(key, value, env);
    });

    const instance = def.create(env);
    activePrototype = instance;
    activePrototypeId = def.id;

    restoreControlState(def.id, savedControls);

    toggleState.forEach((value, key) => {
      activePrototype?.onToggleChange?.(key, value, env);
    });

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
      togglePanel.destroy?.();
      activePrototypeId = null;
    },
  };

  function initializeToggles(defs, savedState = {}) {
    togglePanel.mount(defs, (key, value) => handleToggleChange(key, value));
    toggleState.clear();
    paused = false;
    pausedTimestamp = null;
    defs.forEach((toggle) => {
      const persisted = savedState?.[toggle.key];
      const value = typeof persisted === 'boolean' ? persisted : Boolean(toggle.value);
      togglePanel.setState(toggle.key, value);
      handleToggleChange(toggle.key, value, { skipNotify: true, skipPersist: true });
    });
  }

  function handleToggleChange(key, value, options = {}) {
    const next = Boolean(value);
    toggleState.set(key, next);
    if (!options.skipPersist && activePrototypeId) {
      persistToggleValue(activePrototypeId, key, next);
    }
    if (key === 'paused') {
      paused = next;
      if (!paused) pausedTimestamp = null;
    }
    if (!options.skipNotify) {
      activePrototype?.onToggleChange?.(key, next, env);
    }
  }

  function loadControlState(id) {
    if (!id) return {};
    if (controlStateCache.has(id)) return controlStateCache.get(id);
    const raw = safeStorage('getItem', `${CONTROL_STORAGE_PREFIX}${id}`);
    if (!raw) {
      controlStateCache.set(id, {});
      return controlStateCache.get(id);
    }
    try {
      const parsed = JSON.parse(raw) || {};
      controlStateCache.set(id, parsed);
      return parsed;
    } catch (_) {
      controlStateCache.set(id, {});
      return controlStateCache.get(id);
    }
  }

  function persistControlValue(id, key, value) {
    if (!id) return;
    const state = { ...loadControlState(id), [key]: value };
    controlStateCache.set(id, state);
    safeStorage('setItem', `${CONTROL_STORAGE_PREFIX}${id}`, JSON.stringify(state));
  }

  function restoreControlState(id, saved) {
    if (!saved) return;
    Object.entries(saved).forEach(([key, value]) => {
      controlPanel.update(key, value);
    });
  }

  function loadToggleState(id) {
    if (!id) return {};
    if (togglePrefCache.has(id)) return togglePrefCache.get(id);
    const raw = safeStorage('getItem', `${TOGGLE_STORAGE_PREFIX}${id}`);
    if (!raw) {
      togglePrefCache.set(id, {});
      return togglePrefCache.get(id);
    }
    try {
      const parsed = JSON.parse(raw) || {};
      togglePrefCache.set(id, parsed);
      return parsed;
    } catch (_) {
      togglePrefCache.set(id, {});
      return togglePrefCache.get(id);
    }
  }

  function persistToggleValue(id, key, value) {
    if (!id) return;
    const state = { ...loadToggleState(id), [key]: value };
    togglePrefCache.set(id, state);
    safeStorage('setItem', `${TOGGLE_STORAGE_PREFIX}${id}`, JSON.stringify(state));
  }
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
