const CONTROL_STORAGE_KEY = 'stratified.controls';
const HOTKEY_CODES = {
  pause: 'Space',
  slow: 'KeyS',
  bake: 'KeyB',
  dump: 'KeyD',
};
const PERSISTED_CONTROL_KEYS = new Set([
  'spawnCount',
  'maxArtifacts',
  'timeScale',
  'scale',
  'centerBias',
  'wobble',
  'gravityY',
  'damping',
  'iterations',
  'cameraSpeed',
  'groundHeight',
  'groundAmp',
  'groundFreq',
  'strataIntensity',
  'strataAging',
  'debugView',
  'pixelWidth',
  'pixelHeight',
  'pixelSnap',
  'paletteId',
  'scrollSpeed',
  'spawnCadence',
  'groundEnabled',
  'ditherEnabled',
  'ditherStrength',
  'ditherLevels',
  'paused',
]);
const SLOW_MOTION_FACTOR = 0.25;
const FORCE_BAKE_SUBSTEPS = 12;

export const OPTIMAL_DEFAULTS = Object.freeze({
  spawnCount: 10,
  maxArtifacts: 180,
  pixelWidth: 512,
  pixelHeight: 288,
  timeScale: 0.4,
  scrollSpeed: 0.15,
  spawnCadence: 12,
  groundEnabled: false,
  ditherEnabled: true,
  ditherStrength: 0.65,
  ditherLevels: 24,
  materialWeights: {
    box: 0,
    wrapper: 0,
    coin: 1,
  },
});

function mixColor(a = [0, 0, 0, 1], b = [0, 0, 0, 1], t = 0) {
  const clamped = Math.min(Math.max(t, 0), 1);
  return [
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
    a[3] + (b[3] - a[3]) * clamped,
  ];
}

function applyCompactionToPalette(base, amount = 0) {
  if (!base) return base;
  const level = Math.min(Math.max(amount, 0), 1);
  return {
    primary: mixColor(base.primary, base.secondary, level * 0.25),
    secondary: mixColor(base.secondary, base.sediment, level * 0.35),
    shadow: mixColor(base.shadow, base.primary, level * 0.15),
    sediment: mixColor(base.sediment, base.shadow, level * 0.65),
  };
}

class StratifiedController {
  constructor({
    env,
    renderer,
    streamConfig,
    resolvePalette,
    initialPaletteId = 'oxidized',
    paletteBase,
    defaults = OPTIMAL_DEFAULTS,
    restThreshold = 0.015,
    slowMotionFactor = SLOW_MOTION_FACTOR,
  }) {
    this.env = env;
    this.renderer = renderer;
    this.streamConfig = streamConfig;
    this.resolvePalette = typeof resolvePalette === 'function' ? resolvePalette : null;
    this.defaults = defaults;
    this.state = this.#createInitialState({
      restThreshold,
      slowMotionFactor,
      paletteBase,
      initialPaletteId,
      env,
    });
    this.persistedSnapshot = this.#loadPersistedControls();
    this.suppressedControls = new Set();
    this.hotkeysAttached = false;
    this.listeners = new Map();
    this.handleKeydown = this.handleKeydown.bind(this);

    this.renderer?.setPixelResolution(this.state.pixelWidth, this.state.pixelHeight);
    this.syncRendererDither();
    this.syncActivePalette();
  }

  getState() {
    return this.state;
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.listeners.delete(event);
    }
  }

  emit(event, payload) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        console.error('[StratifiedController] handler failed', error);
      }
    });
  }

  bindHotkeys() {
    if (this.hotkeysAttached || typeof window === 'undefined') return;
    window.addEventListener('keydown', this.handleKeydown, { passive: false });
    this.hotkeysAttached = true;
  }

  unbindHotkeys() {
    if (!this.hotkeysAttached || typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.handleKeydown, { passive: false });
    this.hotkeysAttached = false;
  }

  handleKeydown(event) {
    if (event.repeat || this.#isTypingTarget(event.target)) {
      return;
    }
    switch (event.code) {
      case HOTKEY_CODES.pause:
        event.preventDefault();
        this.togglePause(!this.state.paused);
        break;
      case HOTKEY_CODES.slow:
        event.preventDefault();
        this.toggleSlowMotion();
        break;
      case HOTKEY_CODES.bake:
        event.preventDefault();
        this.forceBake();
        break;
      case HOTKEY_CODES.dump:
        event.preventDefault();
        this.emit('contactDump');
        break;
      default:
        break;
    }
  }

  togglePause(nextValue = !this.state.paused) {
    this.state.paused = Boolean(nextValue);
    this.syncControl('paused', this.state.paused);
    this.#persistControlValue('paused', this.state.paused);
    this.setStatus(this.state.paused ? 'Simulation paused' : 'Simulation resumed', 2);
  }

  toggleSlowMotion(forceValue) {
    const desired = typeof forceValue === 'boolean' ? forceValue : !this.state.slowMotion;
    this.state.slowMotion = desired;
    this.setStatus(desired ? 'Slow motion enabled' : 'Slow motion disabled', 2);
  }

  forceBake() {
    const budget = Math.max(this.state.maxSubsteps * FORCE_BAKE_SUBSTEPS, FORCE_BAKE_SUBSTEPS);
    this.state.forceBakeFrames = Math.max(0, budget);
    this.setStatus('Force baking next strata layers', 2.5);
  }

  setStatus(message, ttl = 2) {
    this.state.statusMessage = message;
    this.state.statusTimer = ttl;
    this.emit('status', { message, ttl });
  }

  syncControl(key, value) {
    if (!this.env.controls?.update) return;
    this.suppressedControls.add(key);
    this.env.controls.update(key, value);
  }

  syncRendererDither() {
    this.renderer?.setDitherOptions?.({
      enabled: this.state.ditherEnabled,
      strength: this.state.ditherStrength,
      levels: this.state.ditherLevels,
    });
  }

  syncActivePalette() {
    this.state.palette = applyCompactionToPalette(this.state.paletteBase, this.state.compactionLevel);
  }

  applyPersistedControls() {
    // Intentionally no-op: we are forcing fresh defaults every load for diagnostics.
  }

  handleControlChange(key, value, hooks = {}) {
    if (this.suppressedControls.has(key)) {
      this.suppressedControls.delete(key);
      return;
    }
    let persistedValue = value;
    let shouldPersist = false;
    switch (key) {
      case 'spawnCount':
        persistedValue = Math.max(1, Math.min(200, Math.round(Number(value))));
        this.state.spawnCount = persistedValue;
        this.state.needsRespawn = true;
        shouldPersist = true;
        break;
      case 'timeScale':
        persistedValue = Math.min(1, Math.max(0.05, Number(value)));
        this.state.timeScale = persistedValue;
        shouldPersist = true;
        break;
      case 'pixelWidth':
        this.state.pixelWidth = Math.max(64, Math.min(2048, Math.round(Number(value) || 0)));
        this.renderer?.setPixelResolution(this.state.pixelWidth, this.state.pixelHeight);
        shouldPersist = true;
        break;
      case 'pixelHeight':
        this.state.pixelHeight = Math.max(64, Math.min(2048, Math.round(Number(value) || 0)));
        this.renderer?.setPixelResolution(this.state.pixelWidth, this.state.pixelHeight);
        shouldPersist = true;
        break;
      case 'pixelSnap':
        this.state.pixelSnap = Boolean(value);
        shouldPersist = true;
        break;
      case 'paletteId': {
        const palette = this.resolvePalette?.(value);
        if (palette) {
          this.state.paletteId = palette.id;
          this.state.paletteBase = hooks.toLinearPalette ? hooks.toLinearPalette(palette) : palette;
          this.syncActivePalette();
          shouldPersist = true;
          persistedValue = this.state.paletteId;
        }
        break;
      }
      case 'scrollSpeed':
        this.state.scrollSpeed = Math.max(0, Number(value));
        shouldPersist = true;
        break;
      case 'compactionRate':
        this.state.compactionRate = Math.max(0, Number(value));
        this.syncActivePalette();
        shouldPersist = true;
        break;
      case 'ditherEnabled':
        this.state.ditherEnabled = Boolean(value);
        this.syncRendererDither();
        shouldPersist = true;
        break;
      case 'ditherStrength':
        this.state.ditherStrength = Math.min(1, Math.max(0, Number(value)));
        this.syncRendererDither();
        shouldPersist = true;
        break;
      case 'ditherLevels':
        this.state.ditherLevels = Math.max(2, Math.min(64, Math.round(Number(value))));
        this.syncRendererDither();
        shouldPersist = true;
        break;
      case 'scale':
        persistedValue = Number(value);
        this.state.scale = persistedValue;
        shouldPersist = true;
        break;
      case 'centerBias':
        persistedValue = Number(value);
        this.state.centerBias = persistedValue;
        shouldPersist = true;
        break;
      case 'wobble':
        persistedValue = Number(value);
        this.state.wobble = persistedValue;
        shouldPersist = true;
        break;
      case 'gravityY':
        persistedValue = Number(value);
        this.state.gravity = [0, persistedValue, 0];
        shouldPersist = true;
        break;
      case 'damping':
        persistedValue = Number(value);
        this.state.damping = persistedValue;
        shouldPersist = true;
        break;
      case 'iterations':
        persistedValue = Math.max(1, Math.round(Number(value)));
        this.state.iterations = persistedValue;
        shouldPersist = true;
        break;
      case 'paused':
        this.togglePause(Boolean(value));
        return;
      case 'groundHeight':
        persistedValue = Number(value);
        this.state.groundHeight = persistedValue;
        shouldPersist = true;
        break;
      case 'groundAmp':
        persistedValue = Number(value);
        this.state.groundAmp = persistedValue;
        shouldPersist = true;
        break;
      case 'groundFreq':
        persistedValue = Number(value);
        this.state.groundFreq = persistedValue;
        shouldPersist = true;
        break;
      case 'groundEnabled':
        this.state.groundEnabled = Boolean(value);
        persistedValue = this.state.groundEnabled;
        shouldPersist = true;
        break;
      case 'circleBillboard':
        this.state.circleBillboard = Boolean(value);
        return;
      case 'strataIntensity':
        persistedValue = Math.max(0.001, Number(value));
        this.state.strataIntensity = persistedValue;
        shouldPersist = true;
        break;
      case 'strataAging':
        persistedValue = Math.min(0.999, Math.max(0.9, Number(value)));
        this.state.strataAging = persistedValue;
        shouldPersist = true;
        break;
      case 'debugView':
        this.state.debugView = String(value);
        persistedValue = this.state.debugView;
        shouldPersist = true;
        break;
      case 'spawnCadence':
        persistedValue = Math.max(0, Number(value));
        this.state.spawnCadence = persistedValue;
        this.state.spawnTimer = 0;
        shouldPersist = true;
        break;
      case 'recyclePool':
        if (value) {
          hooks.recycleArtifactPool?.();
        }
        this.syncControl('recyclePool', false);
        return;
      case 'maxArtifacts':
        persistedValue = Math.max(1, Math.min(this.streamConfig?.maxArtifacts ?? Infinity, Math.round(Number(value))));
        this.state.maxArtifacts = persistedValue;
        this.state.needsRespawn = true;
        shouldPersist = true;
        break;
      case 'cameraSpeed':
        persistedValue = Math.max(0, Number(value));
        this.state.cameraSpeed = persistedValue;
        shouldPersist = true;
        break;
      case 'restThreshold':
        persistedValue = Math.max(0.001, Number(value));
        this.state.restThreshold = persistedValue;
        shouldPersist = true;
        break;
      case 'weightBox':
      case 'weightWrapper':
      case 'weightCoin': {
        persistedValue = Math.max(0, Number(value));
        const keyName = key.replace('weight', '').toLowerCase();
        if (!this.state.materialWeights) {
          this.state.materialWeights = {};
        }
        this.state.materialWeights[keyName] = persistedValue;
        this.state.needsRespawn = true;
        shouldPersist = true;
        break;
      }
      case 'exportPNG':
        if (value) {
          hooks.requestPNGExport?.();
        }
        return;
      case 'exportWebM':
        if (value) {
          hooks.requestWebMExport?.();
        } else if (this.state.recordingWebM) {
          hooks.stopWebMRecording?.();
        }
        return;
      case 'factoryReset':
        hooks.factoryReset?.();
        return;
      default:
        return;
    }

    if (shouldPersist && PERSISTED_CONTROL_KEYS.has(key)) {
      this.#persistControlValue(key, persistedValue);
    }
  }

  #createInitialState({ restThreshold, slowMotionFactor, paletteBase, initialPaletteId, env }) {
    return {
      spawnCount: this.defaults.spawnCount,
      maxArtifacts: Math.min(this.defaults.maxArtifacts, this.streamConfig?.maxArtifacts ?? Infinity),
      timeScale: this.defaults.timeScale ?? 1,
      scale: 280,
      centerBias: 0.62,
      needsRespawn: true,
      lastSeed: env.seed,
      time: 0,
      frame: 0,
      wobble: 0.006,
      gravity: [0, -981, 0],
      damping: 0.96,
      iterations: 1,
      cameraSpeed: 6,
      strataAging: 0.985,
      paused: false,
      groundHeight: -0.3,
      groundAmp: 0.12,
      groundFreq: 1.2,
      strataIntensity: 0.018,
      debugView: 'composite',
      pixelWidth: this.defaults.pixelWidth,
      pixelHeight: this.defaults.pixelHeight,
      pixelSnap: true,
      paletteId: initialPaletteId,
      paletteBase: paletteBase ?? null,
      palette: paletteBase ?? null,
      scrollSpeed: this.defaults.scrollSpeed,
      scrollOffset: 0,
      compactionRate: 0.035,
      compactionLevel: 0,
      spawnCadence: this.defaults.spawnCadence,
      spawnTimer: 0,
      groundEnabled: Boolean(this.defaults.groundEnabled),
      pendingStreamWave: false,
      poolSuppressed: false,
      poolSuppressedSince: 0,
      poolSuppressedReason: '',
      poolEvents: [],
      streamCount: 0,
      materialWeights: { ...this.defaults.materialWeights },
      fixedDelta: 1 / 120,
      maxSubsteps: 5,
      accumulator: 0,
      restThreshold,
      slowMotion: false,
      slowMoFactor: slowMotionFactor,
      forceBakeFrames: 0,
      recordingWebM: false,
      recordingStartTime: 0,
      statusMessage: '',
      statusTimer: 0,
      captureAccumulator: 0,
      ditherEnabled: this.defaults.ditherEnabled,
      ditherStrength: this.defaults.ditherStrength,
      ditherLevels: this.defaults.ditherLevels,
      debugSettledSlots: 0,
      debugPoolActive: 0,
      debugPoolCapacity: 0,
      debugSpawnBuilders: [],
      debugSpawnVerts: 0,
      debugSpawnIndices: 0,
      debugSpawnPreview: [],
      debugCameraCenterX: 0,
      debugCameraCenterY: 0,
      circleBillboard: false,
    };
  }

  #loadPersistedControls() {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage?.getItem(CONTROL_STORAGE_KEY);
      if (!raw) return null;
      const snapshot = JSON.parse(raw);
      return snapshot && typeof snapshot === 'object' ? snapshot : null;
    } catch (error) {
      console.warn('Failed to read stratified controls', error);
      return null;
    }
  }

  #persistControlValue(key, value) {
    if (!PERSISTED_CONTROL_KEYS.has(key) || typeof window === 'undefined') return;
    const snapshot = this.persistedSnapshot && typeof this.persistedSnapshot === 'object'
      ? { ...this.persistedSnapshot }
      : {};
    snapshot[key] = value;
    this.persistedSnapshot = snapshot;
    try {
      window.localStorage?.setItem(CONTROL_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn('Failed to persist stratified controls', error);
    }
  }

  #isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }
}

export { StratifiedController, CONTROL_STORAGE_KEY, PERSISTED_CONTROL_KEYS, SLOW_MOTION_FACTOR };
