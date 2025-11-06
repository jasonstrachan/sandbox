import { BUILD_LABEL } from '../build-info.js';

const ISO_SCALE = 0.70710678;

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

function estimateVRAM(bufferStats = {}, contactBuffers) {
  const vertexBytes = (bufferStats.vertices ?? 0) * 48;
  const indexBytes = (bufferStats.indices ?? 0) * 4;
  const edgeBytes = (bufferStats.edges ?? 0) * 16;
  const hingeBytes = (bufferStats.hinges ?? 0) * 32;
  const contactBytes = (contactBuffers?.capacity || 0) * (contactBuffers?.stride || 0);
  const strataBytes = 512 * 512 * (8 + 8 + 2 + 2 + 4 + 4);
  return vertexBytes + indexBytes + edgeBytes + hingeBytes + contactBytes + strataBytes;
}

function fallbackPoolSnapshot(state) {
  const events = Array.isArray(state?.poolEvents) ? state.poolEvents.slice(-8) : [];
  return {
    suppressed: state?.poolSuppressed ?? false,
    reason: state?.poolSuppressedReason ?? '',
    events: events.map((event) => ({ ...event })),
    maxArtifacts: state?.maxArtifacts ?? 0,
  };
}

export function createStratifiedHUD({ overlayCtx, infoPanel }) {
  return {
    render({ state, fps, simStepMs, bufferStats, metrics, contactBuffers }) {
      if (!state) return;
      const overlay = overlayCtx;
      const hudInfoPanel = infoPanel;
      const artifactSnapshot = metrics?.artifact ?? {};
      const poolSnapshot = metrics?.pool ?? fallbackPoolSnapshot(state);
      const lineHeight = 28;
      const lines = [];
      const write = (text) => {
        lines.push(text);
      };

      write(`Build: ${BUILD_LABEL}`);
      write(`Seed: ${state.lastSeed || state.seed || 'n/a'}`);
      write(`Artifacts: ${artifactSnapshot.total ?? 0}/${state.maxArtifacts}`);
      write(`Verts: ${bufferStats?.vertices ?? 0} | Indices: ${bufferStats?.indices ?? 0}`);
      write(`Edges: ${bufferStats?.edges ?? 0} | Hinges: ${bufferStats?.hinges ?? 0}`);
      write(`FPS: ${fps.toFixed(1)} | Sim Δt: ${(simStepMs ?? 0).toFixed(2)} ms`);
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
      if (state.debugSpawnBuilders?.length) {
        write(
          `Spawn mesh: ${state.debugSpawnBuilders.join(', ')} | avgVerts ${state.debugSpawnVerts} | avgIdx ${state.debugSpawnIndices}`
        );
      }
      const poolStatus = poolSnapshot.suppressed ? ' — paused' : '';
      write(`Pool ${artifactSnapshot?.total ?? 0}/${state.maxArtifacts}${poolStatus}`);
      if (poolSnapshot.events?.length) {
        const lastEvent = poolSnapshot.events[poolSnapshot.events.length - 1];
        write(
          `Pool last: ${lastEvent.type || 'n/a'} @f${lastEvent.frame ?? 0}` +
            (lastEvent.reason ? ` (${lastEvent.reason})` : '')
        );
      }
      write(
        `Pool debug: settledSlots ${state.debugSettledSlots} | capacity ${state.debugPoolCapacity} | rest ${state.restThreshold.toFixed(3)}`
      );
      write(`Gravity Y: ${state.gravity[1].toFixed(0)} | Damping: ${state.damping.toFixed(2)} | Iter: ${state.iterations}`);
      write(
        `Ground ${state.groundHeight.toFixed(2)} | Amp ${state.groundAmp.toFixed(2)} | Freq ${state.groundFreq.toFixed(2)}`
      );
      write(`Strata intensity ${state.strataIntensity.toFixed(3)} | Contact cap ${contactBuffers?.capacity ?? 0}`);
      write(
        `Debug: ${state.debugView} | Aging ${(state.strataAging * 100).toFixed(1)}% | Camera ${state.cameraSpeed.toFixed(1)}`
      );
      const approxVRAM = estimateVRAM(bufferStats, contactBuffers);
      write(
        `VRAM ~ ${formatBytes(approxVRAM)} | Contacts/frame: ${metrics?.contacts?.lastFrame ?? 0}`
      );
      if (artifactSnapshot?.total) {
        write(`Active ${artifactSnapshot.active}/${artifactSnapshot.total} | Settled ${artifactSnapshot.settled}`);
        write(
          `Impulse avg ${(artifactSnapshot.avgImpulse ?? 0).toFixed(3)} | Contacts/artifact ${(artifactSnapshot.avgContacts ?? 0).toFixed(2)}`
        );
      }
      const simTimings = metrics?.timings ?? {};
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
        write('');
        write(state.statusMessage);
      }

      const shouldDrawOverlay = overlay && !hudInfoPanel;
      overlay?.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);
      if (shouldDrawOverlay && overlay) {
        if (state.circleBillboard) {
          drawBillboardCircles(overlay, state);
        }
        overlay.fillStyle = 'rgba(255,255,255,0.9)';
        overlay.font = '24px "IBM Plex Mono", Menlo, monospace';
        overlay.textAlign = 'left';
        overlay.textBaseline = 'top';
        let line = 24;
        for (const text of lines) {
          if (!text) {
            line += lineHeight;
            continue;
          }
          overlay.fillText(text, 16, line);
          line += lineHeight;
        }
      }

      if (hudInfoPanel) {
        const joined = lines.join('\n');
        if (hudInfoPanel.textContent !== joined) {
          hudInfoPanel.textContent = joined;
        }
      }
    },
  };
}

function drawBillboardCircles(ctx, state) {
  const previews = Array.isArray(state.debugSpawnPreview) ? state.debugSpawnPreview : [];
  if (!previews.length) return;
  const centerX = state.debugCameraCenterX || state.pixelWidth / 2;
  const centerY = state.debugCameraCenterY || state.pixelHeight / 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  previews.forEach((preview) => {
    const iso = projectIso(preview.x ?? 0, preview.y ?? 0, preview.z ?? 0, state.scale, centerX, centerY);
    const radius = Math.max(0.002, preview.r ?? 0.03) * state.scale;
    ctx.beginPath();
    ctx.arc(iso.x, iso.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();
}

function projectIso(x, y, z, scale, centerX, centerY) {
  const isoX = (x - z) * ISO_SCALE * scale + centerX;
  const isoY = (y * -0.9 + (x + z) * 0.35) * scale + centerY;
  return { x: isoX, y: isoY };
}

export function buildDiagnosticsSnapshot({ pipeline, simulation }) {
  const metrics = pipeline?.getMetrics?.() ?? {};
  const artifactStats = metrics.artifact ?? simulation.getArtifactMetrics?.();
  const timings = metrics.timings ?? simulation.getTimings?.();
  const contactBuffers = simulation.getContactBuffers();
  return {
    timings,
    contacts: {
      lastFrameContacts: metrics.contacts?.lastFrame ?? 0,
      capacity: metrics.contacts?.capacity ?? contactBuffers?.capacity ?? 0,
      avgContactsPerArtifact: metrics.contacts?.avgContacts ?? artifactStats?.avgContacts ?? 0,
      avgImpulse: metrics.contacts?.avgImpulse ?? artifactStats?.avgImpulse ?? 0,
    },
    pool: metrics.pool ?? pipeline?.getPoolSnapshot?.(),
  };
}

export function buildPoolSnapshot(pipeline, state) {
  return pipeline?.getPoolSnapshot?.() ?? fallbackPoolSnapshot(state);
}

function snapshotControls(controls = [], state) {
  const snapshot = {};
  controls.forEach((control) => {
    if (!control?.key || control.key.startsWith('export')) return;
    snapshot[control.key] = controlValue(control.key, state);
  });
  snapshot.weightBox = state?.materialWeights?.box ?? 0;
  snapshot.weightWrapper = state?.materialWeights?.wrapper ?? 0;
  snapshot.weightCoin = state?.materialWeights?.coin ?? 0;
  return snapshot;
}

function controlValue(key, state = {}) {
  if (key === 'gravityY') return state.gravity?.[1];
  if (key in state) return state[key];
  return undefined;
}

export function buildExportManifest({
  stratifiedMeta,
  state,
  env,
  renderer,
  strata,
  simulation,
  pipeline,
  controls,
  extra = {},
}) {
  const timeSeconds = state?.time ?? 0;
  return {
    id: stratifiedMeta?.id ?? 'stratified',
    version: stratifiedMeta?.version ?? '0.0.0',
    seed: env?.seed,
    timestamp: new Date().toISOString(),
    frames: state?.frame ?? 0,
    timeSeconds: Number(timeSeconds && typeof timeSeconds.toFixed === 'function' ? timeSeconds.toFixed(5) : timeSeconds),
    controls: snapshotControls(controls, state),
    gravity: state?.gravity,
    iterations: state?.iterations,
    renderer: renderer?.getShaderManifest?.() || [],
    strata: {
      textures: strata?.getTextureInfo?.() || {},
      contactCapacity: simulation?.getContactBuffers?.()?.capacity ?? 0,
    },
    simulation: simulation?.getArtifactMetrics?.(),
    webgpu: {
      adapter: env?.webgpu?.adapter?.name ?? null,
      features: env?.webgpu?.supportedFeatures ?? [],
    },
    pool: pipeline?.getPoolSnapshot?.() ?? fallbackPoolSnapshot(state),
    diagnostics: buildDiagnosticsSnapshot({ pipeline, simulation }),
    ...extra,
  };
}
