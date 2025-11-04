import { createCanvasContext, createWebGLContext, syncOverlayCanvas } from './canvas.js';
import { createRenderLoop } from './loop.js';
import { createControlPanel } from './controls.js';
import { createWebGPUContext } from './webgpu/context.js';
import { createPRNG } from './prng.js';

const SEED_STORAGE_KEY = 'sandbox-active-seed';

export function bootstrapPrototypeHost({
  canvas,
  overlay,
  controlsRoot,
  metaRoot,
  seedRoot,
  prototypes,
  initialPrototypeId,
}) {
  if (!canvas) throw new Error('canvas is required');
  if (!Array.isArray(prototypes) || prototypes.length === 0) {
    throw new Error('At least one prototype definition is required');
  }

  const controlPanel = createControlPanel(controlsRoot);
  const initialSeed = safeStorage('getItem', SEED_STORAGE_KEY) || generateRandomSeed();
  const prng = createPRNG(initialSeed);
  safeStorage('setItem', SEED_STORAGE_KEY, prng.seed);
  let renderingContext = null;
  let overlayView = null;

  const env = {
    canvas,
    overlay,
    ctx: null,
    gl: null,
    prng,
    seed: prng.seed,
    webgpu: null,
    webgpuError: null,
    overlayCtx: null,
    backgroundColor: '#05060a',
    size: () => ({ width: canvas.width, height: canvas.height }),
    setBackground(color) {
      env.backgroundColor = color;
      if (env.ctx) {
        env.ctx.fillStyle = color;
        env.ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else if (env.gl) {
        const gl = env.gl;
        const [r, g, b] = hexToRgb(color || '#000000');
        gl.clearColor(r / 255, g / 255, b / 255, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      } else if (env.webgpu) {
        env.webgpu.clearColor = color;
      }
    },
    clearOverlay() {
      overlayView?.clear?.();
    },
    rand() {
      return prng.nextFloat();
    },
  };

  const seedPanel = seedRoot
    ? initSeedPanel(seedRoot, {
        seed: env.seed,
        onApply: (value) => applySeed(value || env.seed),
        onRandomize: () => applySeed(generateRandomSeed()),
      })
    : null;

  function applySeed(nextSeed) {
    if (!nextSeed) return;
    prng.setSeed(nextSeed);
    env.seed = prng.seed;
    seedPanel?.setValue?.(env.seed);
    safeStorage('setItem', SEED_STORAGE_KEY, env.seed);
    activePrototype?.onSeedChange?.(env.seed, env);
  }

  async function setupContext(kind = '2d') {
    renderingContext?.destroy?.();
    overlayView?.destroy?.();
    env.webgpu = null;
    env.webgpuError = null;

    if (kind.startsWith('webgl')) {
      renderingContext = createWebGLContext(canvas, { contextId: kind });
      env.gl = renderingContext.gl;
      env.ctx = null;
    } else if (kind === 'webgpu') {
      try {
        renderingContext = await createWebGPUContext(canvas);
        env.webgpu = renderingContext;
        env.ctx = null;
        env.gl = null;
      } catch (error) {
        console.warn('WebGPU init failed', error); // eslint-disable-line no-console
        env.webgpuError = error;
        renderingContext = createCanvasContext(canvas);
        env.ctx = renderingContext.ctx;
        env.gl = null;
      }
    } else {
      renderingContext = createCanvasContext(canvas);
      env.ctx = renderingContext.ctx;
      env.gl = null;
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

  async function loadPrototype(id) {
    const def = prototypes.find((proto) => proto.id === id) || prototypes[0];
    if (!def) return;

    if (activePrototype?.destroy) {
      activePrototype.destroy();
    }

    await setupContext(def.context || '2d');

    env.clearOverlay();
    env.setBackground(def.background || '#05060a');

    updateMeta(metaRoot, def);

    const controls = def.controls ?? [];
    controlPanel.mount(controls, (key, value) => {
      activePrototype?.onControlChange?.(key, value, env);
    });

    if (def.context === 'webgpu' && !env.webgpu) {
      renderWebGPUFallback(env, env.webgpuError);
      activePrototype = createFallbackPrototype();
      return;
    }

    const instance = def.create(env);
    activePrototype = instance;
    activePrototype?.onSeedChange?.(env.seed, env);

    if (!loopStarted) {
      loop.start();
      loopStarted = true;
    }
  }

  let loopStarted = false;

  const targetPrototypeId = initialPrototypeId || prototypes[0]?.id;
  if (targetPrototypeId) {
    loadPrototype(targetPrototypeId).catch((error) => {
      console.error('Failed to load initial prototype', error); // eslint-disable-line no-console
    });
  } else {
    console.warn('No prototypes registered; nothing to load.'); // eslint-disable-line no-console
  }

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

function initSeedPanel(root, { seed, onApply, onRandomize }) {
  root.innerHTML = '';

  const title = document.createElement('h3');
  title.textContent = 'Deterministic Seed';
  root.appendChild(title);

  const row = document.createElement('div');
  row.className = 'seed-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = seed;
  input.placeholder = 'Enter seed…';

  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.textContent = 'Apply';

  applyButton.addEventListener('click', () => onApply?.(input.value.trim()));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      onApply?.(input.value.trim());
    }
  });

  row.appendChild(input);
  row.appendChild(applyButton);
  root.appendChild(row);

  const randomButton = document.createElement('button');
  randomButton.type = 'button';
  randomButton.textContent = 'Randomize';
  randomButton.addEventListener('click', () => onRandomize?.());
  root.appendChild(randomButton);

  return {
    setValue(value) {
      input.value = value;
    },
  };
}

function generateRandomSeed() {
  if (typeof crypto !== 'undefined' && crypto?.getRandomValues) {
    const data = new Uint32Array(2);
    crypto.getRandomValues(data);
    return `${data[0].toString(16).padStart(8, '0')}${data[1].toString(16).padStart(8, '0')}`;
  }
  return `${Date.now().toString(16)}${Math.floor(Math.random() * 1e9).toString(16)}`;
}

function renderWebGPUFallback(env, error) {
  if (!env?.ctx) return;
  const { width, height } = env.size();
  env.ctx.fillStyle = '#05060a';
  env.ctx.fillRect(0, 0, width, height);
  env.ctx.fillStyle = '#ffffff';
  env.ctx.font = '16px "IBM Plex Mono", Menlo, monospace';
  env.ctx.textAlign = 'left';
  env.ctx.textBaseline = 'top';
  env.ctx.fillText('WebGPU is not available on this device/browser.', 24, height / 2 - 24);
  if (error?.message) {
    env.ctx.fillStyle = 'rgba(255,255,255,0.75)';
    env.ctx.fillText(error.message, 24, height / 2 + 4);
  }
}

function createFallbackPrototype() {
  return {
    update() {},
    destroy() {},
  };
}
