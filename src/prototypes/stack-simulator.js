import { StackSimulation } from '../sim/state/simulation.js';
import {
  renderStack,
  renderDebugOverlay,
  renderStrataGrid,
  renderGridOverlay,
  renderWarpVectors,
  renderRemnants,
} from '../sim/render/stack-pass.js';
import { listSilhouettes } from '../sim/data/canonical-silhouettes.js';
import { Xoshiro128 } from '../sim/rng/xoshiro128.js';

const shapeOptions = listSilhouettes().map((shape) => ({ value: shape.id, label: shape.title }));
const INITIAL_SEQUENCE = ['box-carton', 'flat-mailer', 'bottle-profile', 'phone-slab', 'handbag-tote', 'skull-icon'];
const CONTACT_HISTORY_LIMIT = 360;
const PROFILING_SCENES = {
  single: ['box-carton'],
  quad: ['box-carton', 'flat-mailer', 'phone-slab', 'handbag-tote'],
  full: ['box-carton', 'flat-mailer', 'bottle-profile', 'phone-slab', 'irregular-shard', 'handbag-tote', 'bicycle-chunk', 'skull-icon'],
  stress: [
    'skull-icon',
    'flat-mailer',
    'skull-icon',
    'irregular-shard',
    'flat-mailer',
    'phone-slab',
    'flat-mailer',
    'phone-slab',
    'bottle-profile',
    'bottle-profile',
    'handbag-tote',
    'handbag-tote',
  ],
};
const NUMERIC_CONTROL_KEYS = new Set([
  'scale',
  'jitter',
  'settleBias',
  'buryEvidenceFrames',
  'velocityDamping',
  'airDrag',
  'writebackDamping',
  'gravityScale',
  'impactBounce',
  'timeScale',
  'plasticBeta',
  'spawnInterval',
  'preloadSeconds',
  'meshDetail',
  'maxArtifacts',
  'contactRigidity',
]);

export const stackSimulator = {
  id: 'stack-simulator',
  title: 'Organic Stack Simulator',
  description: 'XPBD lattice mesh prototype (v0.1) with stretch/area constraints and solver diagnostics.',
  tags: ['v0.1', 'xpbd', 'canvas'],
  background: '#05060a',
  controls: [
    { key: 'shapeId', label: 'Shape', type: 'select', options: shapeOptions, value: shapeOptions[0]?.value },
    { key: 'scale', label: 'Scale', type: 'range', min: 0.65, max: 1.25, step: 0.05, value: 1 },
    { key: 'jitter', label: 'Spawn Jitter', type: 'range', min: 0, max: 8, step: 0.5, value: 0 },
    { key: 'settleBias', label: 'Settle Bias', type: 'range', min: 0, max: 1200, step: 20, value: 520 },
    { key: 'buryEvidenceFrames', label: 'Burial Grace (frames)', type: 'range', min: 0, max: 360, step: 10, value: 120 },
    { key: 'velocityDamping', label: 'Velocity Damping', type: 'range', min: 0, max: 12, step: 0.5, value: 3 },
    { key: 'airDrag', label: 'Air Drag', type: 'range', min: 0, max: 4, step: 0.1, value: 0.6 },
    { key: 'writebackDamping', label: 'Writeback', type: 'range', min: 0, max: 0.5, step: 0.01, value: 0.15 },
    { key: 'gravityScale', label: 'Gravity Scale', type: 'range', min: 0.5, max: 3, step: 0.1, value: 1.35 },
    { key: 'impactBounce', label: 'Impact Bounce', type: 'range', min: 0, max: 0.6, step: 0.02, value: 0.2 },
    { key: 'timeScale', label: 'Time Scale', type: 'range', min: 0.5, max: 4, step: 0.1, value: 1 },
    { key: 'plasticBeta', label: 'Plastic β', type: 'range', min: 0, max: 0.1, step: 0.005, value: 0.02 },
    { key: 'meshDetail', label: 'Mesh Detail', type: 'range', min: 0.4, max: 1.2, step: 0.05, value: 0.8 },
    { key: 'maxArtifacts', label: 'Max Active Meshes', type: 'range', min: 4, max: 24, step: 1, value: 12 },
    {
      key: 'profilingScene',
      label: 'Profiling Scene',
      type: 'select',
      options: [
        { value: 'none', label: 'Freefall' },
        { value: 'single', label: '1 Mesh' },
        { value: 'quad', label: '4 Meshes' },
        { value: 'full', label: '8 Meshes' },
        { value: 'stress', label: 'Stress Stack' },
      ],
      value: 'none',
    },
    { key: 'autoSpawn', label: 'Auto Spawn', type: 'checkbox', value: true },
    { key: 'spawnInterval', label: 'Spawn Interval (s)', type: 'range', min: 0.5, max: 4, step: 0.1, value: 2.2 },
    { key: 'preloadSeconds', label: 'Preload Seconds', type: 'range', min: 0, max: 12, step: 0.5, value: 0 },
    { key: 'showParticles', label: 'Particles', type: 'checkbox', value: true },
    { key: 'showAreaResiduals', label: 'Area Residuals', type: 'checkbox', value: true },
    { key: 'showStretchResiduals', label: 'Edge Residuals', type: 'checkbox', value: true },
    { key: 'showBendResiduals', label: 'Bend Diagnostics', type: 'checkbox', value: true },
    { key: 'showWarp', label: 'Warp Field Overlay', type: 'checkbox', value: false },
  ],
  toggles: [
    { key: 'paused', label: 'Pause', value: false },
    { key: 'wireframe', label: 'Wireframe', value: true },
    { key: 'mesh', label: 'Mesh', value: true },
    { key: 'tierBadges', label: 'Tier Badges', value: true },
    { key: 'contactStats', label: 'Contact Stats Overlay', value: true },
  ],
  create(env) {
    const determinismConfig = resolveDeterminismConfig();
    const simulation = new StackSimulation({
      seed: 'v0.1',
      ...(determinismConfig ? { determinism: determinismConfig } : {}),
    });
    simulation.setBounds(env.size().width, env.size().height);

    const state = {
      shapeId: shapeOptions[0]?.value,
      scale: 1,
      jitter: 0,
      settleBias: 520,
      velocityDamping: 3,
      airDrag: 0.6,
      writebackDamping: 0.15,
      gravityScale: 1.35,
      impactBounce: 0.2,
      timeScale: 1,
      plasticBeta: 0.02,
      buryEvidenceFrames: 120,
      autoSpawn: true,
      spawnInterval: 2.2,
      spawnTimer: 0,
      preloadSeconds: 0,
      meshDetail: 0.8,
      maxArtifacts: 12,
      contactRigidity: 1,
      sequenceIndex: 0,
      rng: new Xoshiro128('stack-prototype'),
      showParticles: true,
      showAreaResiduals: true,
      showStretchResiduals: true,
      showBendResiduals: true,
      showWarp: false,
      profilingScene: 'none',
      contactStatsHistory: [],
    };

    const onKeyDown = (event) => {
      if (!event) return;
      const isSaveCombo = (event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyC';
      if (isSaveCombo) {
        exportContactHistoryCsv(state.contactStatsHistory);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    simulation.setGravityScale?.(state.gravityScale);
    simulation.setTimeScale?.(state.timeScale);
    simulation.setMaxArtifacts?.(state.maxArtifacts, { lock: true });
    simulation.setAirDrag?.(state.airDrag);
    simulation.setRestitution?.(state.impactBounce);
    simulation.setSettleBias?.(state.settleBias);
    simulation.setBuryEvidenceFrames?.(state.buryEvidenceFrames);
    applyContactRigidity(simulation, state.contactRigidity);

    const enqueueNextShape = () => {
      const shape = shapeOptions[state.sequenceIndex % shapeOptions.length];
      state.sequenceIndex += 1;
      const scaleJitter = 0.9 + state.rng.nextFloat() * 0.2;
      simulation.enqueueSpawn({
        shapeId: shape.value,
        scale: state.scale * scaleJitter,
        jitter: state.jitter,
        meshDetail: state.meshDetail,
      });
    };

    const advanceSpawnTimer = (delta) => {
      if (!Number.isFinite(delta) || delta <= 0) return;
      state.spawnTimer += delta;
      if (!state.autoSpawn) return;
      while (state.spawnTimer >= state.spawnInterval) {
        state.spawnTimer -= state.spawnInterval;
        enqueueNextShape();
      }
    };

    const fastForwardSimulation = (seconds) => {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      const fixedDt = simulation.config?.fixedDt ?? 1 / 120;
      let remaining = seconds;
      const iterations = Math.ceil(seconds / fixedDt);
      for (let i = 0; i < iterations && remaining > 1e-6; i += 1) {
        const stepDt = Math.min(fixedDt, remaining);
        simulation.stepFixed(stepDt);
        advanceSpawnTimer(stepDt);
        remaining -= stepDt;
      }
    };

    const applyMaterialOverrides = () => {
      simulation.artifacts.forEach((artifact) => {
        artifact.material.damping.velocity = state.velocityDamping;
        artifact.material.damping.writeback = state.writebackDamping;
        if (artifact.material.plastic) {
          artifact.material.plastic.beta = state.plasticBeta;
        }
      });
    };

    const rebuildScene = () => {
      simulation.reset();
      simulation.setBounds(env.size().width, env.size().height);
      simulation.setMaxArtifacts?.(state.maxArtifacts, { lock: true });
      simulation.setBuryEvidenceFrames?.(state.buryEvidenceFrames);
      state.spawnTimer = 0;
      state.sequenceIndex = 0;
      state.rng = new Xoshiro128('stack-prototype');
      const scene = state.profilingScene === 'none' ? INITIAL_SEQUENCE : PROFILING_SCENES[state.profilingScene] ?? INITIAL_SEQUENCE;
      scene.forEach((shapeId, index) => {
        simulation.enqueueSpawn(
          {
            shapeId,
            scale: state.scale,
            jitter: state.jitter,
            meshDetail: state.meshDetail,
          },
          index * 8
        );
      });
      fastForwardSimulation(state.preloadSeconds);
      applyMaterialOverrides();
      applyContactRigidity(simulation, state.contactRigidity);
    };

    rebuildScene();

    const update = ({ dt, ctx }) => {
      if (!ctx) return;
      const size = env.size();
      simulation.setBounds(size.width, size.height);
      simulation.update(dt);
      const simDt = dt * state.timeScale;
      advanceSpawnTimer(simDt);
      applyMaterialOverrides();
      if (simulation.metrics?.contactStats) {
        recordContactHistory(state.contactStatsHistory, simulation.metrics.contactStats);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, size.width, size.height);
      const shake = simulation.getShakeOffset?.() ?? { x: 0, y: 0 };
      ctx.translate(shake.x, shake.y);
      const warp = simulation.warp;
      renderRemnants(ctx, simulation.remnants, { warp });
      renderStrataGrid(ctx, simulation.grid, { warp });
      const wireframeEnabled = env.getToggleState?.('wireframe') ?? true;
      const meshEnabled = env.getToggleState?.('mesh') ?? true;
      const tierBadgesEnabled = env.getToggleState?.('tierBadges') ?? true;
      renderStack(ctx, simulation.artifacts, {
        showWire: wireframeEnabled,
        showParticles: state.showParticles && meshEnabled,
        showAreaResiduals: state.showAreaResiduals && meshEnabled,
        showJoints: meshEnabled,
        showTierBadges: tierBadgesEnabled,
        warp,
      });
      const overlayCtx = env.overlayCtx;
      if (overlayCtx) {
        overlayCtx.clearRect(0, 0, overlayCtx.canvas.width, overlayCtx.canvas.height);
        const residuals = simulation.metrics?.residuals ?? { stretch: 0, area: 0, bend: 0 };
        const tierCounts = summarizeTierCounts(simulation.artifacts);
        const capacity = simulation.capacity ?? {};
        overlayCtx.save();
        overlayCtx.fillStyle = 'rgba(255,255,255,0.85)';
        overlayCtx.font = '12px "IBM Plex Mono", monospace';
        overlayCtx.fillText(
          `RMS σ: ${residuals.stretch.toFixed(3)}  α: ${residuals.area.toFixed(3)}  κ: ${residuals.bend.toFixed(3)}`,
          12,
          18
        );
        const diffCount = simulation.detector?.getDiffs?.().length ?? simulation.detector?.diffs?.length ?? 0;
        overlayCtx.fillText(`Determinism diffs: ${diffCount}`, 12, 34);
        overlayCtx.fillText(
          `Meshes  A:${tierCounts.active}  S:${tierCounts.resting}  B:${tierCounts.buried}  total:${tierCounts.total}  cap:${capacity.dynamic ?? tierCounts.total}/${capacity.base ?? tierCounts.total}`,
          12,
          50
        );
        const timings = simulation.metrics?.timings ?? { solver: 0, grid: 0, contacts: 0 };
        overlayCtx.fillText(
          `ms solver ${timings.solver?.toFixed?.(2) ?? '0.00'} | grid ${timings.grid?.toFixed?.(2) ?? '0.00'} | contacts ${timings.contacts?.toFixed?.(2) ?? '0.00'}`,
          12,
          66
        );
        const contactOverlayEnabled = env.getToggleState?.('contactStats') ?? true;
        const contactStats = contactOverlayEnabled ? simulation.metrics?.contactStats : null;
        if (contactStats) {
          overlayCtx.fillText(
            `contacts tested ${contactStats.pairsTested ?? 0}  solved ${contactStats.contactsResolved ?? 0}  cache ${contactStats.cacheHits ?? 0}  layered ${contactStats.layerContacts ?? 0}`,
            12,
            82
          );
          overlayCtx.fillText(
            `max penetration ${(contactStats.maxPenetration ?? 0).toFixed(2)}  pinned ${contactStats.pinnedPairs ?? 0}  CCD samples ${contactStats.ccdSamples ?? 0}`,
            12,
            98
          );
          overlayCtx.fillText(`Ctrl+Shift+C to export contact CSV`, 12, 114);
          drawContactHistoryChart(overlayCtx, state.contactStatsHistory);
        }
        const dropStats = simulation.metrics?.dropStats ?? [];
        if (dropStats.length) {
          const latest = dropStats[0];
          overlayCtx.fillText(
            `Drop sample: ${(latest.height ?? 0).toFixed(0)}px in ${(latest.time ?? 0).toFixed(2)}s`,
            12,
            contactStats ? 130 : 82
          );
        }
        overlayCtx.restore();
        renderGridOverlay(overlayCtx, simulation.grid, { warp });
        if (state.showWarp) {
          renderWarpVectors(overlayCtx, warp, { samples: 9 });
        }
        renderDebugOverlay(overlayCtx, simulation.artifacts, {
          showStretchResiduals: state.showStretchResiduals,
          showBendResiduals: state.showBendResiduals,
          warp,
        });
      }
    };

    const onPointer = (event) => {
      if (event.type !== 'pointerdown') return;
      const size = env.size();
      simulation.setBounds(size.width, size.height);
      simulation.enqueueSpawn({
        shapeId: state.shapeId,
        scale: state.scale,
        jitter: state.jitter,
        meshDetail: state.meshDetail,
        position: { x: event.x, y: Math.max(event.y - 120, 40) },
      });
    };

    return {
      update,
      onPointer,
      onControlChange(key, value) {
        const nextValue = coerceControlValue(key, value);
        state[key] = nextValue;
        if (key === 'velocityDamping' || key === 'writebackDamping' || key === 'plasticBeta') {
          applyMaterialOverrides();
        }
        if (key === 'airDrag') {
          simulation.setAirDrag?.(state.airDrag);
        }
        if (key === 'gravityScale') {
          simulation.setGravityScale?.(state.gravityScale);
        }
        if (key === 'settleBias') {
          simulation.setSettleBias?.(state.settleBias);
        }
        if (key === 'buryEvidenceFrames') {
          simulation.setBuryEvidenceFrames?.(state.buryEvidenceFrames);
        }
        if (key === 'timeScale') {
          simulation.setTimeScale?.(state.timeScale);
        }
        if (key === 'impactBounce') {
          simulation.setRestitution?.(state.impactBounce);
        }
        if (key === 'contactRigidity') {
          applyContactRigidity(simulation, state.contactRigidity);
        }
        if (
          key === 'shapeId' ||
          key === 'scale' ||
          key === 'jitter' ||
          key === 'profilingScene' ||
          key === 'preloadSeconds' ||
          key === 'meshDetail'
        ) {
          rebuildScene();
        }
        if (key === 'maxArtifacts') {
          simulation.setMaxArtifacts?.(state.maxArtifacts, { lock: true });
        }
        if (key === 'autoSpawn' && !state.autoSpawn) {
          state.spawnTimer = 0;
        }
      },
      destroy() {
        if (typeof simulation.destroy === 'function') simulation.destroy();
        else simulation.reset();
        window.removeEventListener('keydown', onKeyDown);
      },
    };
  },
};

function resolveDeterminismConfig() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('determinism');
  if (!mode) return null;
  return {
    enabled: true,
    recordGolden: mode === 'record',
    storageKey: params.get('determinismKey') || undefined,
    saveInterval: parsePositiveInt(params.get('determinismSaveInterval')),
  };
}

function parsePositiveInt(value) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function summarizeTierCounts(artifacts) {
  const summary = { active: 0, resting: 0, buried: 0, other: 0, total: 0 };
  artifacts?.forEach((artifact) => {
    const tier = artifact.tier ?? 'active';
    if (summary[tier] === undefined) {
      summary.other += 1;
    } else {
      summary[tier] += 1;
    }
    summary.total += 1;
  });
  return summary;
}

function coerceControlValue(key, value) {
  if (!NUMERIC_CONTROL_KEYS.has(key)) return value;
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function recordContactHistory(history, stats) {
  if (!history || !stats) return;
  const timestamp = (typeof performance !== 'undefined' ? performance.now() : Date.now()) | 0;
  history.push({
    t: timestamp,
    pairsTested: stats.pairsTested ?? 0,
    contactsResolved: stats.contactsResolved ?? 0,
    maxPenetration: stats.maxPenetration ?? 0,
  });
  while (history.length > CONTACT_HISTORY_LIMIT) history.shift();
}

function drawContactHistoryChart(ctx, history) {
  if (!ctx || !history?.length) return;
  const chartWidth = 220;
  const chartHeight = 60;
  const margin = 12;
  const originX = ctx.canvas.width - chartWidth - margin;
  const originY = ctx.canvas.height - chartHeight - margin;
  ctx.save();
  ctx.fillStyle = 'rgba(5,6,10,0.7)';
  ctx.fillRect(originX, originY, chartWidth, chartHeight);
  if (history.length < 2) {
    ctx.restore();
    return;
  }
  const subset = history.slice(-chartWidth);
  const maxPen = subset.reduce((acc, s) => Math.max(acc, s.maxPenetration ?? 0), 0.01);
  const maxResolved = subset.reduce((acc, s) => Math.max(acc, s.contactsResolved ?? 0), 1);
  plotSeries(ctx, subset, originX, originY, chartWidth, chartHeight, maxPen, (s) => s.maxPenetration ?? 0, '#f472b6');
  plotSeries(ctx, subset, originX, originY, chartWidth, chartHeight, maxResolved, (s) => s.contactsResolved ?? 0, '#34d399');
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillText('pen (pink) / contacts (green)', originX + 8, originY + 12);
  ctx.restore();
}

function plotSeries(ctx, samples, originX, originY, width, height, maxValue, accessor, strokeStyle) {
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  samples.forEach((sample, index) => {
    const value = accessor(sample);
    const norm = Math.min(value, maxValue) / (maxValue || 1);
    const px = originX + (index / (samples.length - 1)) * width;
    const py = originY + height - norm * height;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}

function exportContactHistoryCsv(history) {
  if (!history?.length) return;
  const header = 'timestamp_ms,pairs_tested,contacts_resolved,max_penetration';
  const rows = history.map((sample) => `${sample.t},${sample.pairsTested},${sample.contactsResolved},${sample.maxPenetration}`);
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `contact-stats-${Date.now()}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function applyContactRigidity(simulation, rigidity) {
  if (!simulation) return;
  const t = clamp01Local(rigidity ?? 0);
  const baseConfig = simulation.contactConfig ?? {};
  const tuned = {
    contactIterations: Math.round(lerp(2, 12, t)),
    contactCompliance: lerp(0.0005, 0, t),
    slop: lerp(0.35, 0.02, t),
    radiusScale: lerp(1, 1.7, t),
  };
  simulation.contactConfig = { ...baseConfig, ...tuned };
  if (simulation.contactState?.cache?.clear) {
    simulation.contactState.cache.clear();
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01Local(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
