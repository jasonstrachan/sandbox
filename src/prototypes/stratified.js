import { createArtifactFactory } from '../stratified/factory.js';
import { createStratifiedRenderer } from '../stratified/renderer.js';
import { createSimulation } from '../stratified/simulation.js';
import { createStrataAccumulator } from '../stratified/strata.js';
import { createWebMEncoder } from '../utils/webm-encoder.js';
import { PALETTES, getPalette, paletteColorsLinear } from '../stratified/palettes.js';
import {
  StratifiedController,
  OPTIMAL_DEFAULTS,
  PERSISTED_CONTROL_KEYS,
  SLOW_MOTION_FACTOR,
  CONTROL_STORAGE_KEY,
} from '../stratified/controller.js';
import { StratifiedPipeline } from '../stratified/pipeline.js';
import { createStratifiedHUD, buildExportManifest } from '../stratified/hud.js';

/** @typedef {import('../stratified/types.js').SimulationPoolConfig} SimulationPoolConfig */

const STRATA_EXTENT = 0.65;

const DEBUG_VIEW_MODES = {
  composite: 0,
  pigment: 1,
  thickness: 2,
  shear: 3,
  height: 4,
};

const STRATIFIED_VERSION = '0.2.0';
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
/**
 * @typedef {Object} PoolEvent
 * @property {string} type
 * @property {number} frame
 * @property {number} time
 * @property {string | null} reason
 * @property {number} reused
 * @property {number} appended
 * @property {number} total
 */
/**
 * @typedef {Object} StratifiedDefaults
 * @property {number} spawnCount
 * @property {number} maxArtifacts
 * @property {number} pixelWidth
 * @property {number} pixelHeight
 * @property {number} scrollSpeed
 * @property {number} spawnCadence
 * @property {number} timeScale
 * @property {boolean} ditherEnabled
 * @property {number} ditherStrength
 * @property {number} ditherLevels
 * @property {boolean} groundEnabled
 * @property {Record<string, number>} materialWeights
 */

export const stratified = {
  id: 'stratified',
  title: '',
  description: '',
  tags: [],
  background: '#05060a',
  controls: [
    {
      key: 'spawnCount',
      label: 'Spawn Count',
      type: 'range',
      min: 1,
      max: 128,
      step: 1,
      value: OPTIMAL_DEFAULTS.spawnCount,
    },
    {
      key: 'timeScale',
      label: 'Time Scale',
      type: 'range',
      min: 0.05,
      max: 1,
      step: 0.05,
      value: OPTIMAL_DEFAULTS.timeScale,
    },
    {
      key: 'maxArtifacts',
      label: 'Pool Cap',
      type: 'number',
      min: 32,
      max: STREAM_POOL_CONFIG.maxArtifacts,
      step: 1,
      value: OPTIMAL_DEFAULTS.maxArtifacts,
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
    { key: 'groundEnabled', label: 'Ground Plane', type: 'checkbox', value: OPTIMAL_DEFAULTS.groundEnabled },
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
    {
      key: 'restThreshold',
      label: 'Rest Threshold',
      type: 'range',
      min: 0.001,
      max: 0.08,
      step: 0.001,
      value: DEFAULT_REST_THRESHOLD,
      devOnly: true,
    },
    {
      key: 'factoryReset',
      label: 'Factory Reset',
      type: 'action',
      actionLabel: 'Clear & Reload',
      devOnly: true,
    },
    {
      key: 'circleBillboard',
      label: 'Billboard Circles',
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
    {
      key: 'paused',
      label: 'Playback',
      type: 'toggle',
      value: false,
      onLabel: 'Play',
      offLabel: 'Pause',
    },
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
    const controller = new StratifiedController({
      env,
      renderer,
      streamConfig: STREAM_POOL_CONFIG,
      resolvePalette: getPalette,
      initialPaletteId: initialPalette?.id ?? 'oxidized',
      paletteBase: basePalette,
      restThreshold: DEFAULT_REST_THRESHOLD,
      slowMotionFactor: SLOW_MOTION_FACTOR,
    });
    const state = controller.getState();

    controller.on('contactDump', handleContactDump);
    controller.on('status', ({ message }) => {
      if (message) {
        env.host?.setStatus?.(message);
      }
    });

    const pipeline = new StratifiedPipeline({
      env,
      controller,
      factory,
      renderer,
      simulation,
      strata,
      strataExtent: STRATA_EXTENT,
    });

    const overlay = env.overlayCtx;
    const hudInfoPanel = getHudInfoPanel();
    const hud = createStratifiedHUD({ overlayCtx: overlay, infoPanel: hudInfoPanel });
    let fps = 0;
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let simStepMs = 0;
    let lastFrameTime = performance?.now?.() ?? Date.now();
    let mediaRecorder = null;
    let mediaRecorderTimeout = null;
    let mediaRecorderChunks = [];
    let frameRecorder = null;
    let pendingCapture = Promise.resolve();

    const syncControl = controller.syncControl.bind(controller);

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

    function requestFactoryReset() {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage?.removeItem(CONTROL_STORAGE_KEY);
      } catch (error) {
        console.warn('Failed to clear saved controls', error);
      }
      controller.setStatus('Cleared saved controls — reloading…', 2.5);
      window.setTimeout(() => {
        window.location.reload();
      }, 200);
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
      const manifest = buildExportManifest({
        stratifiedMeta: { id: stratified.id, version: STRATIFIED_VERSION },
        state,
        env,
        renderer,
        strata,
        simulation,
        pipeline,
        controls: stratified.controls,
        extra,
      });
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `${baseName}.json`);
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

    function buildAssetBasename(tag = 'asset') {
      const seed = state.lastSeed || env.seed || 'seed';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      return `stratified-${tag}-${seed}-${timestamp}`;
    }

    function setStatus(message, ttl = 2) {
      controller.setStatus(message, ttl);
    }

    function bindHotkeys() {
      controller.bindHotkeys();
    }

    function unbindHotkeys() {
      controller.unbindHotkeys();
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

    function renderHudOverlay() {
      const bufferStats = simulation.getBufferStats?.() || { vertices: 0, indices: 0, edges: 0, hinges: 0 };
      const metrics = pipeline.getMetrics?.() || {};
      const contactBuffers = simulation.getContactBuffers();
      hud.render({ state, fps, simStepMs, bufferStats, metrics, contactBuffers });
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
        renderHudOverlay();
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

      const scaledDt = dt * (state.timeScale ?? 1);
      const simMetrics = pipeline.tick(scaledDt) || {};
      simStepMs = simMetrics.simStepMs ?? simStepMs;
      const simDt = state.slowMotion ? scaledDt * (state.slowMoFactor ?? SLOW_MOTION_FACTOR) : scaledDt;

      if (state.scrollSpeed > 0 && state.pixelHeight > 0) {
        const scrollDelta = state.scrollSpeed * simDt * state.pixelHeight * SCROLL_MULTIPLIER;
        state.scrollOffset = Math.min(state.scrollOffset + scrollDelta, MAX_SCROLL_OFFSET);
      }


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
      state.debugCameraCenterX = pixelWidth / 2;
      state.debugCameraCenterY = cameraCenterY;

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

      renderer.render({
        clearColor: env.backgroundColor,
        showGround: state.groundEnabled && !state.circleBillboard,
        skipArtifacts: state.circleBillboard,
        drawBillboards: state.circleBillboard,
      });
      renderHudOverlay();
    };

    controller.applyPersistedControls();
    pipeline.rebuildArtifacts({ preserveStrata: false, fillMode: 'spawn' });
    bindHotkeys();

    return {
      update,
      onControlChange(key, value) {
        controller.handleControlChange(key, value, {
          recycleArtifactPool: () => pipeline.recyclePool({ preserveStrata: true }),
          requestPNGExport,
          requestWebMExport,
          stopWebMRecording,
          factoryReset: requestFactoryReset,
          toLinearPalette: paletteColorsLinear,
        });
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
        if (hudInfoPanel) {
          hudInfoPanel.textContent = '';
        }
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

function getHudInfoPanel() {
  if (typeof document === 'undefined') {
    return null;
  }
  return /** @type {HTMLElement | null} */ (document.getElementById('hud-info'));
}
