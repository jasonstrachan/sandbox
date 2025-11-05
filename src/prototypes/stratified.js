import { createArtifactFactory } from '../stratified/factory.js';
import { createStratifiedRenderer } from '../stratified/renderer.js';
import { createSimulation } from '../stratified/simulation.js';
import { createStrataAccumulator } from '../stratified/strata.js';
import { createWebMEncoder } from '../utils/webm-encoder.js';
import { PALETTES, getPalette, paletteColorsLinear } from '../stratified/palettes.js';

/** @typedef {import('../stratified/types.js').SimulationPoolConfig} SimulationPoolConfig */

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

const STRATA_EXTENT = 0.65;

const DEBUG_VIEW_MODES = {
  composite: 0,
  pigment: 1,
  thickness: 2,
  shear: 3,
  height: 4,
};

const MATERIAL_KEYS = ['box', 'wrapper', 'coin'];
const STRATIFIED_VERSION = '0.2.0';
const CONTROL_STORAGE_KEY = 'stratified.controls.v1';
const PERSISTED_CONTROL_KEYS = new Set([
  'spawnCount',
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
  'ditherEnabled',
  'ditherStrength',
  'ditherLevels',
  'paused',
]);
const HOTKEY_CODES = {
  pause: 'Space',
  slow: 'KeyS',
  bake: 'KeyB',
  dump: 'KeyD',
};
const SLOW_MOTION_FACTOR = 0.25;
const FORCE_BAKE_SUBSTEPS = 12;
const CONTACT_DUMP_LIMIT = 48;
const EXPORT_WEBM_DURATION_MS = 8000;
const DEFAULT_REST_THRESHOLD = 0.015;
const WEBM_FPS = 30;
const WEBM_FRAME_INTERVAL = 1 / WEBM_FPS;
const MAX_SCROLL_OFFSET = 100000;
const SCROLL_MULTIPLIER = 0.02;
/** @type {SimulationPoolConfig} */
const STREAM_POOL_CONFIG = Object.freeze({
  maxArtifacts: 256,
  maxVertices: 262144,
  maxIndices: 1048576,
  maxEdges: 786432,
  maxHinges: 786432,
});
const SPAWN_SPREAD_X = 0.45;
const SPAWN_HEIGHT_BASE = 0.9;
const SPAWN_HEIGHT_JITTER = 0.08;
const SPAWN_DEPTH_OFFSET = 0;
/**
 * @typedef {Object} StratifiedDefaults
 * @property {number} spawnCount
 * @property {number} maxArtifacts
 * @property {number} pixelWidth
 * @property {number} pixelHeight
 * @property {number} scrollSpeed
 * @property {number} spawnCadence
 * @property {boolean} ditherEnabled
 * @property {number} ditherStrength
 * @property {number} ditherLevels
 * @property {Record<string, number>} materialWeights
 */

/** @type {StratifiedDefaults} */
const OPTIMAL_DEFAULTS = Object.freeze({
  spawnCount: 18,
  maxArtifacts: 180,
  pixelWidth: 512,
  pixelHeight: 288,
  scrollSpeed: 0.25,
  spawnCadence: 7,
  ditherEnabled: true,
  ditherStrength: 0.65,
  ditherLevels: 24,
  materialWeights: {
    box: 1,
    wrapper: 0.85,
    coin: 0.35,
  },
});

export const stratified = {
  id: 'stratified',
  title: '',
  description: '',
  tags: [],
  background: '#05060a',
  controls: [
    {
      key: 'spawnCount',
      label: 'Artifacts',
      type: 'number',
      min: 1,
      max: 200,
      step: 1,
      value: OPTIMAL_DEFAULTS.spawnCount,
    },
    { key: 'scale', label: 'Iso Scale', type: 'range', min: 160, max: 520, step: 10, value: 280 },
    {
      key: 'pixelWidth',
      label: 'Pixel Width',
      type: 'number',
      min: 128,
      max: 2048,
      step: 16,
      value: OPTIMAL_DEFAULTS.pixelWidth,
    },
    {
      key: 'pixelHeight',
      label: 'Pixel Height',
      type: 'number',
      min: 128,
      max: 2048,
      step: 16,
      value: OPTIMAL_DEFAULTS.pixelHeight,
    },
    { key: 'pixelSnap', label: 'Pixel Snap', type: 'checkbox', value: true },
    {
      key: 'paletteId',
      label: 'Palette',
      type: 'select',
      options: PALETTES.map((palette) => ({ value: palette.id, label: palette.name })),
      value: PALETTES[0]?.id ?? 'oxidized',
    },
    {
      key: 'scrollSpeed',
      label: 'Scroll Speed',
      type: 'range',
      min: 0,
      max: 12,
      step: 0.1,
      value: OPTIMAL_DEFAULTS.scrollSpeed,
    },
    { key: 'centerBias', label: 'Vertical Bias', type: 'range', min: 0.3, max: 0.85, step: 0.01, value: 0.62 },
    { key: 'wobble', label: 'Wobble', type: 'range', min: 0, max: 0.02, step: 0.0005, value: 0.006 },
    { key: 'gravityY', label: 'Gravity Y', type: 'range', min: -2000, max: 0, step: 10, value: -981 },
    { key: 'damping', label: 'Damping', type: 'range', min: 0.5, max: 1, step: 0.01, value: 0.96 },
    { key: 'iterations', label: 'Iterations', type: 'number', min: 1, max: 8, step: 1, value: 1 },
    { key: 'cameraSpeed', label: 'Camera Drift', type: 'range', min: 0, max: 10, step: 0.25, value: 6 },
    { key: 'groundHeight', label: 'Ground Y', type: 'range', min: -1, max: 0.2, step: 0.01, value: -0.3 },
    { key: 'groundAmp', label: 'Terrain Amp', type: 'range', min: 0, max: 0.5, step: 0.01, value: 0.12 },
    { key: 'groundFreq', label: 'Terrain Freq', type: 'range', min: 0.2, max: 4, step: 0.1, value: 1.2 },
    { key: 'strataIntensity', label: 'Strata Intensity', type: 'range', min: 0.005, max: 0.05, step: 0.001, value: 0.018 },
    { key: 'strataAging', label: 'Strata Aging', type: 'range', min: 0.94, max: 0.999, step: 0.001, value: 0.985 },
    {
      key: 'debugView',
      label: 'Debug View',
      type: 'select',
      options: [
        { value: 'composite', label: 'Composite' },
        { value: 'pigment', label: 'Pigment' },
        { value: 'thickness', label: 'Thickness / Contacts' },
        { value: 'shear', label: 'Shear Vectors' },
        { value: 'height', label: 'Heightfield' },
      ],
      value: 'composite',
    },
    {
      key: 'spawnCadence',
      label: 'Respawn Interval (s)',
      type: 'range',
      min: 0,
      max: 60,
      step: 1,
      value: OPTIMAL_DEFAULTS.spawnCadence,
    },
    {
      key: 'recyclePool',
      label: 'Recycle Pool',
      type: 'checkbox',
      value: false,
      devOnly: true,
    },
    { key: 'ditherEnabled', label: 'Dither', type: 'checkbox', value: OPTIMAL_DEFAULTS.ditherEnabled },
    {
      key: 'ditherStrength',
      label: 'Dither Strength',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.05,
      value: OPTIMAL_DEFAULTS.ditherStrength,
    },
    {
      key: 'ditherLevels',
      label: 'Dither Levels',
      type: 'number',
      min: 2,
      max: 64,
      step: 1,
      value: OPTIMAL_DEFAULTS.ditherLevels,
    },
    { key: 'paused', label: 'Pause', type: 'checkbox', value: false },
  ],
  context: 'webgpu',
  create(env) {
    if (!env.webgpu) {
      return createFallbackPrototype('WebGPU unavailable');
    }

    const factory = createArtifactFactory({ prng: env.prng, poolConfig: STREAM_POOL_CONFIG });
    const renderer = createStratifiedRenderer(env);
    const simulation = createSimulation(env, STREAM_POOL_CONFIG);
    const strata = createStrataAccumulator(env);
    renderer.setStrataTextures(strata.getTextureViews());

    const initialPalette = getPalette(PALETTES[0]?.id);
    const basePalette = paletteColorsLinear(initialPalette);
    const state = {
      spawnCount: OPTIMAL_DEFAULTS.spawnCount,
      maxArtifacts: Math.min(OPTIMAL_DEFAULTS.maxArtifacts, STREAM_POOL_CONFIG.maxArtifacts),
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
      pixelWidth: OPTIMAL_DEFAULTS.pixelWidth,
      pixelHeight: OPTIMAL_DEFAULTS.pixelHeight,
      pixelSnap: true,
      paletteId: initialPalette?.id ?? 'oxidized',
      paletteBase: basePalette,
      palette: basePalette,
      scrollSpeed: OPTIMAL_DEFAULTS.scrollSpeed,
      scrollOffset: 0,
      compactionRate: 0.035,
      compactionLevel: 0,
      spawnCadence: OPTIMAL_DEFAULTS.spawnCadence,
      spawnTimer: 0,
      pendingStreamWave: false,
      poolSuppressed: false,
      poolSuppressedSince: 0,
      poolSuppressedReason: '',
      streamCount: 0,
      materialWeights: { ...OPTIMAL_DEFAULTS.materialWeights },
      fixedDelta: 1 / 120,
      maxSubsteps: 5,
      accumulator: 0,
      restThreshold: DEFAULT_REST_THRESHOLD,
      slowMotion: false,
      slowMoFactor: SLOW_MOTION_FACTOR,
      forceBakeFrames: 0,
      recordingWebM: false,
      recordingStartTime: 0,
      statusMessage: '',
      statusTimer: 0,
      captureAccumulator: 0,
      ditherEnabled: OPTIMAL_DEFAULTS.ditherEnabled,
      ditherStrength: OPTIMAL_DEFAULTS.ditherStrength,
      ditherLevels: OPTIMAL_DEFAULTS.ditherLevels,
    };

    function syncActivePalette() {
      state.palette = applyCompactionToPalette(state.paletteBase, state.compactionLevel);
    }

    function syncRendererDither() {
      renderer.setDitherOptions?.({
        enabled: state.ditherEnabled,
        strength: state.ditherStrength,
        levels: state.ditherLevels,
      });
    }

    renderer.setPixelResolution(state.pixelWidth, state.pixelHeight);
    syncRendererDither();
    syncActivePalette();

    const overlay = env.overlayCtx;
    let fps = 0;
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let simStepMs = 0;
    let lastFrameTime = performance?.now?.() ?? Date.now();
    let contactEvents = 0;
    let mediaRecorder = null;
    let mediaRecorderTimeout = null;
    let mediaRecorderChunks = [];
    let frameRecorder = null;
    let pendingCapture = Promise.resolve();
    let hotkeysAttached = false;
    let contactsBound = false;

    function spawnArtifactBatch(count) {
      const weights = buildMaterialWeights(state.materialWeights);
      for (let i = 0; i < count; i += 1) {
        factory.spawn(weights ? { weights } : undefined);
      }
      const batch = {
        artifacts: factory.artifacts.slice(),
        meshViews: factory.staging.mesh.getViews(),
        constraintViews: factory.staging.constraints.getViews(),
      };
      scatterArtifactBatch(batch);
      return batch;
    }

    function scatterArtifactBatch(batch) {
      const { artifacts, meshViews } = batch;
      const positions = meshViews?.positions;
      if (!artifacts?.length || !positions) return;
      const rand = env.prng ?? Math;
      const next = () => (typeof rand.nextFloat === 'function' ? rand.nextFloat() : Math.random());
      artifacts.forEach((artifact, index) => {
        const range = artifact?.ranges?.meshRange;
        if (!range?.vertexCount) return;
        const spawnT = (index + next()) / Math.max(artifacts.length, 1);
        const jitterX = (next() * 2 - 1) * SPAWN_SPREAD_X;
        const spawnX = jitterX * (0.5 + spawnT * 0.5);
        const spawnY = SPAWN_HEIGHT_BASE + (next() * 2 - 1) * SPAWN_HEIGHT_JITTER;
        const spawnZ = SPAWN_DEPTH_OFFSET;
        translateVertices(positions, range, spawnX, spawnY, spawnZ, { flattenZ: true });
      });
    }

    function translateVertices(buffer, meshRange, tx, ty, tz, { flattenZ = false } = {}) {
      const vertexOffset = meshRange.vertexOffset ?? 0;
      const vertexCount = meshRange.vertexCount ?? 0;
      if (vertexCount <= 0) return;
      const start = vertexOffset * 3;
      for (let v = 0; v < vertexCount; v += 1) {
        const i = start + v * 3;
        buffer[i] += tx;
        buffer[i + 1] += ty;
        buffer[i + 2] = flattenZ ? tz : buffer[i + 2] + tz;
      }
    }

    function applyArtifactBatch(batch, { reset = false } = {}) {
      if (!batch?.artifacts?.length) return 0;
      let appended = 0;
      try {
        if (typeof simulation.appendFromStaging === 'function') {
          appended = simulation.appendFromStaging(
            batch.meshViews,
            batch.constraintViews,
            batch.artifacts,
            { reset }
          ) || 0;
        } else {
          simulation.uploadFromStaging(batch.meshViews, batch.constraintViews, batch.artifacts);
          appended = batch.artifacts.length;
        }
      } catch (error) {
        console.error('Artifact append failed', error);
        setStatus('Spawn failed — check console output', 4);
        appended = 0;
      }
      if (appended === 0 && reset) {
        console.warn('Streaming append unavailable, falling back to full respawn upload');
        simulation.uploadFromStaging(batch.meshViews, batch.constraintViews, batch.artifacts);
        appended = batch.artifacts.length;
        state.pendingStreamWave = false;
      }
      if (appended > 0) {
        renderer.setGeometryBuffers(simulation.getGeometryBuffers());
        if (!contactsBound) {
          strata.bindContacts(simulation.getContactBuffers());
          contactsBound = true;
        }
      }
      return appended;
    }

    function rebuildArtifacts({ preserveStrata = false, fillMode = 'spawn' } = {}) {
      state.needsRespawn = false;
      state.pendingStreamWave = false;
      factory.reset();
      const targetCount = fillMode === 'max' ? state.maxArtifacts : state.spawnCount;
      const spawnTotal = Math.min(targetCount, state.maxArtifacts);
      const batch = spawnArtifactBatch(spawnTotal);
      const appended = applyArtifactBatch(batch, { reset: true });
      factory.reset();
      if (!appended) return;
      if (!preserveStrata) {
        strata.clear();
        state.streamCount = 0;
        state.scrollOffset = 0;
        state.compactionLevel = 0;
      } else {
        state.streamCount += 1;
        state.compactionLevel = Math.min(1, state.compactionLevel + state.compactionRate);
      }
      syncActivePalette();
      clearSpawnSuppression();
    }

    function spawnStreamWave() {
      const metrics = simulation.getArtifactMetrics?.() || {};
      const active = metrics.total ?? 0;
      const capacity = Math.max(0, state.maxArtifacts - active);
      const spawnTotal = Math.min(state.spawnCount, capacity);
      if (spawnTotal <= 0) {
        suppressSpawns('Artifact pool full — recycle to spawn more');
        return 0;
      }
      factory.reset();
      const batch = spawnArtifactBatch(spawnTotal);
      const appended = applyArtifactBatch(batch, { reset: false });
      factory.reset();
      if (appended > 0) {
        state.streamCount += 1;
        state.compactionLevel = Math.min(1, state.compactionLevel + state.compactionRate);
        syncActivePalette();
        clearSpawnSuppression();
      }
      return appended;
    }

    function suppressSpawns(reason = 'Artifact pool full') {
      if (state.poolSuppressed) return;
      state.poolSuppressed = true;
      state.poolSuppressedReason = reason;
      state.poolSuppressedSince = performance?.now?.() ?? Date.now();
      setStatus(reason, 3);
    }

    function clearSpawnSuppression() {
      if (!state.poolSuppressed) return;
      state.poolSuppressed = false;
      state.poolSuppressedReason = '';
      state.poolSuppressedSince = 0;
    }

    function recycleArtifactPool({ preserveStrata = true } = {}) {
      setStatus('Recycling artifact pool…', 2);
      rebuildArtifacts({ preserveStrata, fillMode: 'max' });
      clearSpawnSuppression();
      state.spawnTimer = 0;
    }

    /**
     * @param {Record<string, number>} source
     * @returns {Record<string, number> | null}
     */
    function buildMaterialWeights(source) {
      if (!source) return null;
      /** @type {Record<string, number>} */
      const weights = {};
      let total = 0;
      MATERIAL_KEYS.forEach((key) => {
        const value = Math.max(0, Number(source[key] ?? 0));
        if (value > 0) {
          weights[key] = value;
          total += value;
        }
      });
      return total > 0 ? weights : null;
    }

    let persistedSnapshot = loadPersistedControls();

    function loadPersistedControls() {
      if (typeof window === 'undefined') return null;
      try {
        const raw = window.localStorage?.getItem(CONTROL_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        console.warn('Failed to read stratified controls', error); 
        return null;
      }
    }

    function persistControlValue(key, value) {
      if (!PERSISTED_CONTROL_KEYS.has(key) || typeof window === 'undefined') return;
      const snapshot = persistedSnapshot && typeof persistedSnapshot === 'object' ? { ...persistedSnapshot } : {};
      snapshot[key] = value;
      persistedSnapshot = snapshot;
      try {
        window.localStorage?.setItem(CONTROL_STORAGE_KEY, JSON.stringify(snapshot));
      } catch (error) {
        console.warn('Failed to persist stratified controls', error); 
      }
    }

    function applyPersistedControls(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return;
      Object.entries(snapshot).forEach(([key, value]) => {
        if (!PERSISTED_CONTROL_KEYS.has(key)) return;
        env.controls?.update?.(key, value);
      });
    }

    const suppressedControls = new Set();

    function syncControl(key, value) {
      if (!env.controls?.update) return;
      suppressedControls.add(key);
      env.controls.update(key, value);
    }

    async function requestPNGExport() {
      if (!env.canvas) {
        setStatus('Canvas unavailable for PNG export', 3);
        syncControl('exportPNG', false);
        return;
      }
      const baseName = buildAssetBasename('png');
      try {
        const blob = await canvasToBlob(env.canvas);
        downloadBlob(blob, `${baseName}.png`);
        downloadManifest(baseName, {
          asset: {
            type: 'png',
            extension: 'png',
            width: env.canvas.width,
            height: env.canvas.height,
          },
        });
        setStatus('PNG export saved', 2.5);
      } catch (error) {
        console.error('PNG export failed', error);
        setStatus('PNG export failed', 3);
      } finally {
        syncControl('exportPNG', false);
      }
    }

    function requestWebMExport() {
      if (state.recordingWebM) {
        stopWebMRecording();
        return;
      }
      if (!startWebMRecording()) {
        setStatus('WebM capture unsupported', 3);
        syncControl('exportWebM', false);
      }
    }

    function startWebMRecording() {
      state.recordingStartTime = performance?.now?.() ?? Date.now();
      state.captureAccumulator = 0;
      if (startFrameRecorder()) {
        state.recordingWebM = true;
        scheduleRecordingTimeout();
        setStatus('WebM capture (WebCodecs)', 2.5);
        return true;
      }
      if (beginMediaRecorder()) {
        state.recordingWebM = true;
        scheduleRecordingTimeout();
        setStatus('WebM capture started', 2.5);
        return true;
      }
      state.recordingStartTime = 0;
      return false;
    }

    function startFrameRecorder() {
      if (!supportsFrameRecorder()) return false;
      try {
        frameRecorder = createFrameRecorder(env.canvas, { fps: WEBM_FPS });
        pendingCapture = Promise.resolve();
        return true;
      } catch (error) {
        console.error('Frame recorder init failed', error);
        frameRecorder = null;
        return false;
      }
    }

    function beginMediaRecorder() {
      if (!env.canvas?.captureStream || typeof MediaRecorder === 'undefined') {
        return false;
      }
      let stream;
      try {
        stream = env.canvas.captureStream(60);
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
      } catch (error) {
        console.error('Failed to start MediaRecorder', error);
        mediaRecorder = null;
        return false;
      }
      mediaRecorderChunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event?.data && event.data.size > 0) {
          mediaRecorderChunks.push(event.data);
        }
      };
      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error', event?.error || event);
        setStatus('WebM capture error', 3);
        mediaRecorder = null;
        finishRecording();
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(mediaRecorderChunks, { type: 'video/webm' });
        mediaRecorder = null;
        mediaRecorderChunks = [];
        finalizeVideoExport(blob, buildVideoMeta('mediarecorder'));
        finishRecording();
      };
      mediaRecorder.start();
      return true;
    }

    function stopWebMRecording({ cancelled = false } = {}) {
      clearRecordingTimeout();
      if (frameRecorder) {
        const recorder = frameRecorder;
        frameRecorder = null;
        const pending = pendingCapture.catch(() => {}).then(() => recorder.stop());
        pending
          .then((blob) => {
            finalizeVideoExport(blob, buildVideoMeta('webcodecs'));
          })
          .catch((error) => {
            console.error('WebM capture failed', error);
            setStatus('WebM capture failed', 3);
          })
          .finally(() => {
            finishRecording();
          });
        pendingCapture = Promise.resolve();
        return;
      }
      if (mediaRecorder) {
        try {
          mediaRecorder.stop();
        } catch (error) {
          console.error('MediaRecorder stop failed', error);
          finishRecording();
        }
        return;
      }
      if (!cancelled) {
        finishRecording();
      }
    }

    function scheduleRecordingTimeout() {
      if (typeof window === 'undefined') return;
      clearRecordingTimeout();
      mediaRecorderTimeout = window.setTimeout(() => {
        stopWebMRecording();
      }, EXPORT_WEBM_DURATION_MS);
    }

    function clearRecordingTimeout() {
      if (mediaRecorderTimeout) {
        clearTimeout(mediaRecorderTimeout);
        mediaRecorderTimeout = null;
      }
    }

    function finishRecording() {
      clearRecordingTimeout();
      state.recordingWebM = false;
      state.recordingStartTime = 0;
      syncControl('exportWebM', false);
    }

    function canvasToBlob(canvas) {
      return new Promise((resolve, reject) => {
        if (canvas.toBlob) {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob returned empty blob'));
          }, 'image/png');
          return;
        }
        try {
          const dataUrl = canvas.toDataURL('image/png');
          const binary = atob(dataUrl.split(',')[1]);
          const array = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            array[i] = binary.charCodeAt(i);
          }
          resolve(new Blob([array], { type: 'image/png' }));
        } catch (error) {
          reject(error);
        }
      });
    }

    function downloadBlob(blob, filename) {
      if (typeof document === 'undefined') return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function downloadManifest(baseName, extra = {}) {
      const manifest = buildExportManifest(extra);
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `${baseName}.json`);
    }

    function buildExportManifest(extra = {}) {
      return {
        id: stratified.id,
        version: STRATIFIED_VERSION,
        seed: env.seed,
        timestamp: new Date().toISOString(),
        frames: state.frame,
        timeSeconds: Number(state.time.toFixed(5)),
        controls: collectControlSnapshot(),
        gravity: state.gravity,
        iterations: state.iterations,
        renderer: renderer.getShaderManifest?.() || [],
        strata: {
          textures: strata.getTextureInfo?.() || {},
          contactCapacity: simulation.getContactBuffers()?.capacity ?? 0,
        },
        simulation: simulation.getArtifactMetrics?.(),
        webgpu: {
          adapter: env.webgpu?.adapter?.name ?? null,
          features: env.webgpu?.supportedFeatures ?? [],
        },
        diagnostics: collectDiagnostics(),
        ...extra,
      };
    }

    function collectControlSnapshot() {
      const snapshot = {};
      stratified.controls.forEach((control) => {
        if (!control?.key || control.key.startsWith('export')) return;
        snapshot[control.key] = controlValue(control.key);
      });
      snapshot.weightBox = state.materialWeights.box;
      snapshot.weightWrapper = state.materialWeights.wrapper;
      snapshot.weightCoin = state.materialWeights.coin;
      return snapshot;
    }

    function controlValue(key) {
      if (key === 'gravityY') return state.gravity[1];
      if (key in state) return state[key];
      return undefined;
    }

    function buildVideoMeta(mode) {
      const durationMs = state.recordingStartTime
        ? Math.max(0, (performance?.now?.() ?? Date.now()) - state.recordingStartTime)
        : 0;
      return {
        type: 'webm',
        extension: 'webm',
        mode,
        width: env.canvas?.width ?? 0,
        height: env.canvas?.height ?? 0,
        durationMs: Math.round(durationMs),
        fps: WEBM_FPS,
      };
    }

    function finalizeVideoExport(blob, asset) {
      if (!asset) return;
      const baseName = buildAssetBasename(asset.type);
      downloadBlob(blob, `${baseName}.${asset.extension || 'bin'}`);
      downloadManifest(baseName, { asset });
      setStatus(`${asset.type.toUpperCase()} export saved`, 3);
    }

    function collectDiagnostics() {
      const timings = simulation.getTimings?.();
      const artifactStats = simulation.getArtifactMetrics?.();
      const contactBuffers = simulation.getContactBuffers();
      return {
        timings,
        contacts: {
          lastFrameContacts: contactEvents,
          capacity: contactBuffers?.capacity ?? 0,
          avgContactsPerArtifact: artifactStats?.avgContacts ?? 0,
          avgImpulse: artifactStats?.avgImpulse ?? 0,
        },
      };
    }

    function buildAssetBasename(tag = 'asset') {
      const seed = state.lastSeed || env.seed || 'seed';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      return `stratified-${tag}-${seed}-${timestamp}`;
    }

    function setStatus(message, ttl = 2) {
      state.statusMessage = message;
      state.statusTimer = ttl;
    }

    function estimateVRAM(stats, contactBuffers) {
      const vertexBytes = stats.vertices * 48;
      const indexBytes = stats.indices * 4;
      const edgeBytes = stats.edges * 16;
      const hingeBytes = stats.hinges * 32;
      const contactBytes = (contactBuffers?.capacity || 0) * (contactBuffers?.stride || 0);
      const strataBytes = 512 * 512 * (8 + 8 + 2 + 2 + 4 + 4);
      return vertexBytes + indexBytes + edgeBytes + hingeBytes + contactBytes + strataBytes;
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let value = bytes;
      let unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
      }
      return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
    }

    const hotkeyOptions = /** @type {AddEventListenerOptions} */ ({ passive: false });

    function bindHotkeys() {
      if (hotkeysAttached || typeof window === 'undefined') return;
      window.addEventListener('keydown', handleKeydown, hotkeyOptions);
      hotkeysAttached = true;
    }

    function unbindHotkeys() {
      if (!hotkeysAttached || typeof window === 'undefined') return;
      window.removeEventListener('keydown', handleKeydown, hotkeyOptions);
      hotkeysAttached = false;
    }

    function handleKeydown(event) {
      if (event.repeat) return;
      if (isTypingTarget(event.target)) return;
      switch (event.code) {
        case HOTKEY_CODES.pause:
          event.preventDefault();
          togglePause(!state.paused);
          break;
        case HOTKEY_CODES.slow:
          event.preventDefault();
          toggleSlowMotion();
          break;
        case HOTKEY_CODES.bake:
          event.preventDefault();
          triggerForceBake();
          break;
        case HOTKEY_CODES.dump:
          event.preventDefault();
          handleContactDump();
          break;
        default:
          break;
      }
    }

    function isTypingTarget(target) {
      if (!target) return false;
      const tag = target.tagName;
      return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    function togglePause(nextValue = !state.paused) {
      state.paused = Boolean(nextValue);
      syncControl('paused', state.paused);
      persistControlValue('paused', state.paused);
      setStatus(state.paused ? 'Simulation paused' : 'Simulation resumed', 2);
    }

    function toggleSlowMotion(forceValue) {
      const desired = typeof forceValue === 'boolean' ? forceValue : !state.slowMotion;
      state.slowMotion = desired;
      setStatus(desired ? 'Slow motion enabled' : 'Slow motion disabled', 2);
    }

    function triggerForceBake() {
      state.forceBakeFrames = Math.max(state.maxSubsteps * FORCE_BAKE_SUBSTEPS, FORCE_BAKE_SUBSTEPS);
      setStatus('Force baking next strata layers', 2.5);
    }

    function handleContactDump() {
      if (typeof simulation.dumpContacts !== 'function') {
        setStatus('Contact dump unavailable', 2);
        return;
      }
      setStatus('Dumping contacts…', 1.5);
      simulation
        .dumpContacts(CONTACT_DUMP_LIMIT)
        .then((report) => {
          const summary = report.samples.map((sample) => ({
            artifact: sample.artifactId,
            impulse: sample.impulse.toFixed(3),
            normal: `${sample.normal.x.toFixed(2)},${sample.normal.y.toFixed(2)},${sample.normal.z.toFixed(2)}`,
            vertex: sample.vertexId,
            material: sample.materialId,
          }));
          console.table(summary);
          setStatus(`Contacts: ${report.count} (showing ${summary.length})`, 3);
        })
        .catch((error) => {
          console.error('Contact dump failed', error);
          setStatus('Contact dump failed', 3);
        });
    }

    function supportsFrameRecorder() {
      return (
        typeof window !== 'undefined' &&
        typeof VideoEncoder !== 'undefined' &&
        typeof VideoFrame !== 'undefined' &&
        typeof createImageBitmap !== 'undefined'
      );
    }

    function createFrameRecorder(canvas, { fps }) {
      if (!canvas) throw new Error('Canvas required for frame recorder');
      const width = canvas.width || canvas.clientWidth || 0;
      const height = canvas.height || canvas.clientHeight || 0;
      const muxer = createWebMEncoder({ width, height, fps });
      const frameDurationUs = Math.round(1_000_000 / fps);
      let nextTimestamp = 0;
      const encoder = new VideoEncoder({
        output: (chunk) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          muxer.addChunk({ data, timestamp: chunk.timestamp ?? nextTimestamp, keyframe: chunk.type === 'key' });
        },
        error: (error) => {
          console.error('VideoEncoder error', error);
        },
      });
      encoder.configure({
        codec: 'vp09.00.10.08',
        width,
        height,
        bitrate: 8_000_000,
        framerate: fps,
        latencyMode: 'quality',
      });

      async function captureFrame(targetCanvas) {
        const bitmap = await createImageBitmap(targetCanvas);
        const frame = new VideoFrame(bitmap, { timestamp: nextTimestamp });
        nextTimestamp += frameDurationUs;
        encoder.encode(frame, { keyFrame: nextTimestamp === frameDurationUs });
        frame.close();
        bitmap.close?.();
      }

      async function stop() {
        await encoder.flush();
        encoder.close();
        return muxer.finalize();
      }

      function cancel() {
        try {
          encoder.close();
        } catch (error) {
          console.warn('Frame recorder cancel error', error); 
        }
      }

      return { captureFrame, stop, cancel };
    }

    function updateOverlay() {
      if (!overlay) return;
      overlay.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);
      overlay.fillStyle = 'rgba(255,255,255,0.9)';
      overlay.font = '24px "IBM Plex Mono", Menlo, monospace';
      overlay.textAlign = 'left';
      overlay.textBaseline = 'top';
      const bufferStats = simulation.getBufferStats?.() || { vertices: 0, indices: 0, edges: 0, hinges: 0 };
      const contactBuffers = simulation.getContactBuffers();
      const approxVRAM = estimateVRAM(bufferStats, contactBuffers);
      const artifactSnapshot = simulation.getArtifactMetrics?.() || {};
      const lineHeight = 28;
      let line = 24;
      const write = (text) => {
        overlay.fillText(text, 16, line);
        line += lineHeight;
      };

      write(`Seed: ${env.seed}`);
      write(`Artifacts: ${artifactSnapshot.total ?? 0}/${state.maxArtifacts}`);
      write(`Verts: ${bufferStats.vertices ?? 0} | Indices: ${bufferStats.indices ?? 0}`);
      write(`Edges: ${bufferStats.edges ?? 0} | Hinges: ${bufferStats.hinges ?? 0}`);
      write(`FPS: ${fps.toFixed(1)} | Sim Δt: ${simStepMs.toFixed(2)} ms`);
      write(
        `Pixel Grid: ${state.pixelWidth}×${state.pixelHeight} | Snap ${state.pixelSnap ? 'On' : 'Off'} | Palette ${state.paletteId}`
      );
      write(
        `Scroll ${state.scrollSpeed.toFixed(2)} | Offset ${state.scrollOffset.toFixed(1)}px | Waves ${state.streamCount}`
      );
      write(
        `Compaction ${(state.compactionLevel * 100).toFixed(1)}% | Dither ${
          state.ditherEnabled ? `${state.ditherLevels} lv` : 'Off'
        }`
      );
      const poolStatus = state.poolSuppressed ? ' — paused' : '';
      write(`Pool ${artifactSnapshot?.total ?? 0}/${state.maxArtifacts}${poolStatus}`);
      write(`Gravity Y: ${state.gravity[1].toFixed(0)} | Damping: ${state.damping.toFixed(2)} | Iter: ${state.iterations}`);
      write(
        `Ground ${state.groundHeight.toFixed(2)} | Amp ${state.groundAmp.toFixed(2)} | Freq ${state.groundFreq.toFixed(2)}`
      );
      write(`Strata intensity ${state.strataIntensity.toFixed(3)} | Contact cap ${contactBuffers?.capacity ?? 0}`);
      write(
        `Debug: ${state.debugView} | Aging ${(state.strataAging * 100).toFixed(1)}% | Camera ${state.cameraSpeed.toFixed(1)}`
      );
      write(`VRAM ~ ${formatBytes(approxVRAM)} | Contacts/frame: ${contactEvents}`);
      if (artifactSnapshot?.total) {
        write(`Active ${artifactSnapshot.active}/${artifactSnapshot.total} | Settled ${artifactSnapshot.settled}`);
        write(
          `Impulse avg ${artifactSnapshot.avgImpulse.toFixed(3)} | Contacts/artifact ${artifactSnapshot.avgContacts.toFixed(2)}`
        );
      }
      const simTimings = simulation.getTimings?.();
      if (simTimings?.passes) {
        const { mode, passes } = simTimings;
        const source = (mode || 'cpu').toUpperCase();
        const format = (label) => {
          const entry = passes[label];
          if (!entry) return '--';
          const value = mode === 'gpu' && entry.gpu > 0 ? entry.gpu : entry.cpu;
          return value > 0 ? value.toFixed(2) : '--';
        };
        write(`Sim ms (${source}): I ${format('integrate')} D ${format('distance')} H ${format('hinge')} R ${format('rest')}`);
      }
      write(`Slow-mo: ${state.slowMotion ? 'On' : 'Off'} | Bake: ${state.forceBakeFrames > 0 ? 'Boost' : 'Idle'}`);
      if (state.recordingWebM) {
        write('Recording WebM…');
      }
      if (state.statusMessage && state.statusTimer > 0) {
        overlay.fillStyle = 'rgba(255,255,255,0.95)';
        overlay.fillText(state.statusMessage, 16, overlay.canvas.height - 20);
      }
    }

    const update = ({ dt }) => {
      if (!env.webgpu) return;
      if (state.statusTimer > 0) {
        state.statusTimer = Math.max(0, state.statusTimer - dt);
        if (state.statusTimer === 0) {
          state.statusMessage = '';
        }
      }
      if (state.paused) {
        updateOverlay();
        return;
      }

      const now = performance?.now?.() ?? Date.now();
      const delta = now - lastFrameTime;
      lastFrameTime = now;
      fpsAccumulator += delta;
      fpsFrames += 1;
      if (fpsAccumulator >= 500) {
        fps = (fpsFrames / fpsAccumulator) * 1000;
        fpsAccumulator = 0;
        fpsFrames = 0;
      }

      if (state.recordingWebM && frameRecorder) {
        state.captureAccumulator += dt;
        if (state.captureAccumulator >= WEBM_FRAME_INTERVAL) {
          state.captureAccumulator -= WEBM_FRAME_INTERVAL;
          pendingCapture = pendingCapture
            .then(() => frameRecorder.captureFrame(env.canvas))
            .catch((error) => {
              console.error('Frame capture failed', error);
              setStatus('WebM capture failed', 3);
              stopWebMRecording({ cancelled: true });
            });
        }
      }

      const slowFactor = state.slowMoFactor ?? SLOW_MOTION_FACTOR;
      const simDt = state.slowMotion ? dt * slowFactor : dt;

      if (state.spawnCadence > 0) {
        state.spawnTimer += simDt;
        if (state.spawnTimer >= state.spawnCadence) {
          state.spawnTimer = 0;
          state.pendingStreamWave = true;
        }
      }

      if (state.needsRespawn) {
        rebuildArtifacts({ preserveStrata: false });
      } else if (state.pendingStreamWave) {
        spawnStreamWave();
        state.pendingStreamWave = false;
      }
      renderer.setGeometryBuffers(simulation.getGeometryBuffers());

      if (state.scrollSpeed > 0 && state.pixelHeight > 0) {
        const scrollDelta = state.scrollSpeed * simDt * state.pixelHeight * SCROLL_MULTIPLIER;
        state.scrollOffset = Math.min(state.scrollOffset + scrollDelta, MAX_SCROLL_OFFSET);
      }

      const frameUniforms = env.webgpu.frameUniforms;
      const fixedDelta = state.fixedDelta;
      const maxAccum = fixedDelta * state.maxSubsteps;
      state.accumulator = Math.min(state.accumulator + simDt, maxAccum);
      let steps = 0;
      let bakeBudget = state.forceBakeFrames;

      while (state.accumulator >= fixedDelta) {
        state.accumulator -= fixedDelta;
        state.time += fixedDelta;
        state.frame += 1;

        frameUniforms.updateFrame({ time: state.time, deltaTime: fixedDelta, frame: state.frame });

        const simStart = performance?.now?.() ?? Date.now();
        const restThreshold = bakeBudget > 0 ? Math.max(0.2, state.restThreshold * 50) : state.restThreshold;
        simulation.step({
          time: state.time,
          wobble: state.wobble,
          gravity: state.gravity,
          damping: state.damping,
          iterations: state.iterations,
          groundHeight: state.groundHeight,
          groundAmp: state.groundAmp,
          groundFreq: state.groundFreq,
          restThreshold,
        });
        simStepMs = (performance?.now?.() ?? Date.now()) - simStart;
        if (bakeBudget > 0) {
          bakeBudget -= 1;
        }

        strata.accumulate({
          contactBuffers: simulation.getContactBuffers(),
          extent: STRATA_EXTENT,
          pointSize: 3.5,
          intensity: state.strataIntensity,
          decay: state.strataAging,
          time: state.time,
        });
        contactEvents = strata.getLastContactCount?.() ?? contactEvents;
        steps += 1;
        if (steps >= state.maxSubsteps) {
          break;
        }
      }

      state.forceBakeFrames = Math.max(0, bakeBudget);

      const pixelWidth = Math.max(1, Math.floor(state.pixelWidth));
      const pixelHeight = Math.max(1, Math.floor(state.pixelHeight));
      const cameraDrift = state.cameraSpeed > 0 ? Math.sin(state.time * state.cameraSpeed * 0.08) * (pixelHeight * 0.05) : 0;
      const baseCenterY = Math.min(
        pixelHeight * 0.95,
        Math.max(pixelHeight * 0.05, pixelHeight * state.centerBias + cameraDrift)
      );
      const scrollWindow = Math.max(pixelHeight * 0.75, 1);
      const scrollPhase = state.scrollOffset % scrollWindow;
      let cameraCenterY = baseCenterY - scrollPhase;
      const minY = pixelHeight * 0.05;
      const maxY = pixelHeight * 0.95;
      while (cameraCenterY < minY) {
        cameraCenterY += pixelHeight;
      }
      while (cameraCenterY > maxY) {
        cameraCenterY -= pixelHeight;
      }

      renderer.updateSceneUniforms({
        width: pixelWidth,
        height: pixelHeight,
        centerX: pixelWidth / 2,
        centerY: cameraCenterY,
        scale: state.scale,
        groundHeight: state.groundHeight,
        groundAmp: state.groundAmp,
        groundFreq: state.groundFreq,
        debugMode: DEBUG_VIEW_MODES[state.debugView] ?? 0,
        debugParam: state.strataAging,
        pixelSnap: state.pixelSnap,
        palette: state.palette,
      });

      renderer.render({ clearColor: env.backgroundColor });
      updateOverlay();
    };

    applyPersistedControls(persistedSnapshot);
    rebuildArtifacts({ preserveStrata: false, fillMode: 'max' });
    bindHotkeys();

    return {
      update,
      onControlChange(key, value) {
        if (suppressedControls.has(key)) {
          suppressedControls.delete(key);
          return;
        }
        let persistedValue = value;
        let shouldPersist = false;
        switch (key) {
          case 'spawnCount':
            persistedValue = Math.max(1, Math.min(200, Math.round(Number(value))));
            state.spawnCount = persistedValue;
            state.needsRespawn = true;
            shouldPersist = true;
            break;
          case 'pixelWidth':
            state.pixelWidth = Math.max(64, Math.min(2048, Math.round(Number(value) || 0)));
            renderer.setPixelResolution(state.pixelWidth, state.pixelHeight);
            shouldPersist = true;
            break;
          case 'pixelHeight':
            state.pixelHeight = Math.max(64, Math.min(2048, Math.round(Number(value) || 0)));
            renderer.setPixelResolution(state.pixelWidth, state.pixelHeight);
            shouldPersist = true;
            break;
          case 'pixelSnap':
            state.pixelSnap = Boolean(value);
            shouldPersist = true;
            break;
          case 'paletteId': {
            const palette = getPalette(value);
            state.paletteId = palette.id;
            state.paletteBase = paletteColorsLinear(palette);
            syncActivePalette();
            shouldPersist = true;
            break;
          }
          case 'scrollSpeed':
            state.scrollSpeed = Math.max(0, Number(value));
            shouldPersist = true;
            break;
          case 'compactionRate':
            state.compactionRate = Math.max(0, Number(value));
            syncActivePalette();
            shouldPersist = true;
            break;
          case 'ditherEnabled':
            state.ditherEnabled = Boolean(value);
            syncRendererDither();
            shouldPersist = true;
            break;
          case 'ditherStrength':
            state.ditherStrength = Math.min(1, Math.max(0, Number(value)));
            syncRendererDither();
            shouldPersist = true;
            break;
          case 'ditherLevels':
            state.ditherLevels = Math.max(2, Math.min(64, Math.round(Number(value))));
            syncRendererDither();
            shouldPersist = true;
            break;
          case 'scale':
            persistedValue = Number(value);
            state.scale = persistedValue;
            shouldPersist = true;
            break;
          case 'centerBias':
            persistedValue = Number(value);
            state.centerBias = persistedValue;
            shouldPersist = true;
            break;
          case 'wobble':
            persistedValue = Number(value);
            state.wobble = persistedValue;
            shouldPersist = true;
            break;
          case 'gravityY':
            persistedValue = Number(value);
            state.gravity = [0, persistedValue, 0];
            shouldPersist = true;
            break;
          case 'damping':
            persistedValue = Number(value);
            state.damping = persistedValue;
            shouldPersist = true;
            break;
          case 'iterations':
            persistedValue = Math.max(1, Math.round(Number(value)));
            state.iterations = persistedValue;
            shouldPersist = true;
            break;
          case 'paused':
            togglePause(Boolean(value));
            return;
          case 'groundHeight':
            persistedValue = Number(value);
            state.groundHeight = persistedValue;
            shouldPersist = true;
            break;
          case 'groundAmp':
            persistedValue = Number(value);
            state.groundAmp = persistedValue;
            shouldPersist = true;
            break;
          case 'groundFreq':
            persistedValue = Number(value);
            state.groundFreq = persistedValue;
            shouldPersist = true;
            break;
          case 'strataIntensity':
            persistedValue = Math.max(0.001, Number(value));
            state.strataIntensity = persistedValue;
            shouldPersist = true;
            break;
          case 'strataAging':
            persistedValue = Math.min(0.999, Math.max(0.9, Number(value)));
            state.strataAging = persistedValue;
            shouldPersist = true;
            break;
          case 'debugView':
            state.debugView = String(value);
            persistedValue = state.debugView;
            shouldPersist = true;
            break;
          case 'spawnCadence':
            persistedValue = Math.max(0, Number(value));
            state.spawnCadence = persistedValue;
            state.spawnTimer = 0;
            shouldPersist = true;
            break;
          case 'recyclePool':
            if (value) {
              recycleArtifactPool({ preserveStrata: true });
            }
            syncControl('recyclePool', false);
            return;
          case 'maxArtifacts':
            persistedValue = Math.max(1, Math.min(STREAM_POOL_CONFIG.maxArtifacts, Math.round(Number(value))));
            state.maxArtifacts = persistedValue;
            state.needsRespawn = true;
            shouldPersist = true;
            break;
          case 'cameraSpeed':
            persistedValue = Math.max(0, Number(value));
            state.cameraSpeed = persistedValue;
            shouldPersist = true;
            break;
          case 'restThreshold':
            persistedValue = Math.max(0.001, Number(value));
            state.restThreshold = persistedValue;
            shouldPersist = true;
            break;
          case 'weightBox':
          case 'weightWrapper':
          case 'weightCoin':
            persistedValue = Math.max(0, Number(value));
            state.materialWeights[key.replace('weight', '').toLowerCase()] = persistedValue;
            state.needsRespawn = true;
            shouldPersist = true;
            break;
          case 'exportPNG':
            if (value) {
              requestPNGExport();
            }
            return;
          case 'exportWebM':
            if (value) {
              requestWebMExport();
            } else if (state.recordingWebM) {
              stopWebMRecording();
            }
            return;
          default:
            return;
        }
        if (shouldPersist && PERSISTED_CONTROL_KEYS.has(key)) {
          persistControlValue(key, persistedValue);
        }
      },
      onSeedChange(newSeed) {
        if (state.lastSeed === newSeed) return;
        state.lastSeed = newSeed;
        state.needsRespawn = true;
        setStatus(`Seed applied: ${newSeed}`, 2);
      },
      onManifestImport(manifest) {
        if (!manifest || manifest.id !== stratified.id) return;
        if (manifest.controls && typeof manifest.controls === 'object') {
          Object.entries(manifest.controls).forEach(([key, controlValue]) => {
            if (PERSISTED_CONTROL_KEYS.has(key)) {
              env.controls?.update?.(key, controlValue);
            }
          });
        }
        if (typeof manifest.seed === 'string' && manifest.seed !== state.lastSeed) {
          state.lastSeed = manifest.seed;
          state.needsRespawn = true;
        }
        setStatus('Manifest loaded', 3);
      },
      destroy() {
        stopWebMRecording();
        unbindHotkeys();
        renderer.destroy();
        simulation.destroy();
        strata.destroy();
        factory.reset();
        overlay?.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);
      },
    };
  },
};

function createFallbackPrototype(message) {
  return {
    update({ ctx }) {
      if (!ctx) return;
      const { canvas } = ctx;
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = '16px "IBM Plex Mono", Menlo, monospace';
      ctx.fillText(message, 24, 48);
    },
    destroy() {},
  };
}
