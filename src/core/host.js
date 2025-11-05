import { createCanvasContext, createWebGLContext, syncOverlayCanvas } from './canvas.js';
import { createRenderLoop } from './loop.js';
import { createControlPanel } from './controls.js';
import { createWebGPUContext } from './webgpu/context.js';
import { createPRNG } from './prng.js';

/**
 * @typedef {ReturnType<typeof createCanvasContext>} Canvas2DContext
 * @typedef {ReturnType<typeof createWebGLContext>} WebGLContextWrapper
 * @typedef {ReturnType<typeof syncOverlayCanvas>} OverlayView
 * @typedef {Awaited<ReturnType<typeof createWebGPUContext>>} WebGPUContext
 * @typedef {ReturnType<typeof createPRNG>} PRNGInstance
 * @typedef {ReturnType<typeof createControlPanel>} ControlPanel
 * @typedef {{
 *   type: string,
 *   x: number,
 *   y: number,
 *   buttons: number,
 *   ctrlKey: boolean,
 *   altKey: boolean,
 *   shiftKey: boolean,
 * }} PrototypePointerEvent
 * @typedef {{
 *   update?: (payload: { ctx: CanvasRenderingContext2D | null, overlayCtx: CanvasRenderingContext2D | null, now: number, dt: number, env: PrototypeHostEnv }) => void,
 *   onControlChange?: (key: string, value: unknown, env: PrototypeHostEnv) => void,
 *   onPointer?: (event: PrototypePointerEvent, env: PrototypeHostEnv) => void,
 *   onSeedChange?: (seed: string, env: PrototypeHostEnv) => void,
 *   onManifestImport?: (manifest: unknown, env: PrototypeHostEnv) => void,
 *   destroy?: () => void,
 * }} PrototypeInstance
 * @typedef {{
 *   id: string,
 *   title?: string,
 *   description?: string,
 *   tags?: string[],
 *   background?: string,
 *   context?: string,
 *   controls?: unknown[],
 *   create: (env: PrototypeHostEnv) => PrototypeInstance,
 * }} PrototypeDefinition
 * @typedef {{
 *   canvas: HTMLCanvasElement,
 *   overlay: HTMLCanvasElement | null,
 *   ctx: CanvasRenderingContext2D | null,
 *   gl: (WebGLRenderingContext | WebGL2RenderingContext) | null,
 *   prng: PRNGInstance,
 *   seed: string,
 *   webgpu: WebGPUContext | null,
 *   webgpuError: unknown,
 *   overlayCtx: CanvasRenderingContext2D | null,
 *   backgroundColor: string,
 *   size: () => { width: number; height: number },
 *   setBackground: (color: string) => void,
 *   clearOverlay: () => void,
 *   rand: () => number,
 *   controls: { update(key: string, value: unknown): void },
 * }} PrototypeHostEnv
 * @typedef {Canvas2DContext | WebGLContextWrapper | WebGPUContext} RenderingContext
 */

const SEED_STORAGE_KEY = 'sandbox-active-seed';

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   overlay?: HTMLCanvasElement | null,
 *   controlsRoot: HTMLElement,
 *   metaRoot?: HTMLElement | null,
 *   seedRoot?: HTMLElement | null,
 *   prototypes: PrototypeDefinition[],
 *   initialPrototypeId?: string | null,
 * }} options
 */
export function bootstrapPrototypeHost({
  canvas,
  overlay = null,
  controlsRoot,
  metaRoot = null,
  seedRoot = null,
  prototypes,
  initialPrototypeId = null,
}) {
  if (!canvas) throw new Error('canvas is required');
  if (!Array.isArray(prototypes) || prototypes.length === 0) {
    throw new Error('At least one prototype definition is required');
  }

  const controlPanel = createControlPanel(controlsRoot);
  const initialSeed = safeStorage('getItem', SEED_STORAGE_KEY) || generateRandomSeed();
  const prng = createPRNG(initialSeed);
  safeStorage('setItem', SEED_STORAGE_KEY, prng.seed);
  /** @type {RenderingContext | null} */
  let renderingContext = null;
  /** @type {OverlayView | null} */
  let overlayView = null;

  /** @type {PrototypeHostEnv} */
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
    controls: {
      update(key, value) {
        controlPanel.update?.(key, value);
      },
    },
  };

  const seedPanel = seedRoot
    ? initSeedPanel(seedRoot, {
        seed: env.seed,
        onApply: (value) => applySeed(value || env.seed),
        onRandomize: () => applySeed(generateRandomSeed()),
        onLoadManifest: handleManifestLoad,
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

  function handleManifestLoad(manifest) {
    if (!manifest || typeof manifest !== 'object') return;
    if (manifest.seed) {
      applySeed(manifest.seed);
    }
    activePrototype?.onManifestImport?.(manifest, env);
  }

  async function setupContext(kind = '2d') {
    renderingContext?.destroy?.();
    overlayView?.destroy?.();
    env.webgpu = null;
    env.webgpuError = null;

    if (kind.startsWith('webgl')) {
      const webglContext = createWebGLContext(canvas, { contextId: kind });
      renderingContext = webglContext;
      env.gl = webglContext.gl;
      env.ctx = null;
    } else if (kind === 'webgpu') {
      try {
        const webgpuContext = await createWebGPUContext(canvas);
        renderingContext = webgpuContext;
        env.webgpu = webgpuContext;
        env.ctx = null;
        env.gl = null;
      } catch (error) {
        console.warn('WebGPU init failed', error);
        env.webgpuError = error;
        const canvasContext = createCanvasContext(canvas);
        renderingContext = canvasContext;
        env.ctx = canvasContext.ctx;
        env.gl = null;
      }
    } else {
      const canvasContext = createCanvasContext(canvas);
      renderingContext = canvasContext;
      env.ctx = canvasContext.ctx;
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

  /** @type {PrototypeInstance | null} */
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
      console.error('Failed to load initial prototype', error);
    });
  } else {
    console.warn('No prototypes registered; nothing to load.');
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
  } catch {
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

function initSeedPanel(root, { seed, onApply, onRandomize, onLoadManifest }) {
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
  let lastAppliedSeed = seed;
  let statusTimer = null;

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
  root.appendChild(row);

  const actionsDetails = document.createElement('details');
  actionsDetails.className = 'seed-actions-group';
  const actionsSummary = document.createElement('summary');
  actionsSummary.textContent = 'Seed Actions';
  actionsDetails.appendChild(actionsSummary);

  const actionBody = document.createElement('div');
  actionBody.className = 'seed-actions-body';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy';
  copyButton.addEventListener('click', async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(input.value);
        flashStatus('Seed copied');
        return;
      }
    } catch (error) {
      console.warn('clipboard write failed', error);
    }
    input.select();
    flashStatus('Copy via ⌘C / Ctrl+C');
  });

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = 'Reset';
  resetButton.addEventListener('click', () => {
    input.value = lastAppliedSeed;
    onApply?.(lastAppliedSeed);
    flashStatus('Seed reset');
  });

  const randomButton = document.createElement('button');
  randomButton.type = 'button';
  randomButton.textContent = 'Randomize';
  randomButton.addEventListener('click', () => onRandomize?.());

  const manifestInput = document.createElement('input');
  manifestInput.type = 'file';
  manifestInput.accept = 'application/json';
  manifestInput.style.display = 'none';
  manifestInput.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.files?.length) return;
    const [file] = target.files;
    try {
      const text = await file.text();
      const manifest = JSON.parse(text);
      onLoadManifest?.(manifest);
      flashStatus('Manifest loaded');
    } catch (error) {
      console.warn('Failed to load manifest', error);
      flashStatus('Manifest invalid');
    } finally {
      target.value = '';
    }
  });
  actionBody.appendChild(manifestInput);

  const loadButton = document.createElement('button');
  loadButton.type = 'button';
  loadButton.textContent = 'Load Manifest';
  loadButton.addEventListener('click', () => manifestInput.click());

  [applyButton, copyButton, resetButton, randomButton, loadButton].forEach((button) => {
    button.className = 'seed-action';
    actionBody.appendChild(button);
  });

  actionsDetails.appendChild(actionBody);
  root.appendChild(actionsDetails);

  const status = document.createElement('p');
  status.className = 'seed-status';
  root.appendChild(status);

  function flashStatus(message) {
    status.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status.textContent = '';
    }, 2000);
  }

  return {
    setValue(value) {
      input.value = value;
      lastAppliedSeed = value;
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
