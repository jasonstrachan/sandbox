import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExportManifest, buildPoolSnapshot } from '../hud.js';

test('buildExportManifest merges metadata, controls, and extra fields', () => {
  const state = {
    frame: 12,
    time: 3.14159,
    gravity: [0, -981, 0],
    iterations: 2,
    spawnCount: 18,
    maxArtifacts: 64,
    materialWeights: { box: 1, wrapper: 0.5, coin: 0.25 },
  };
  const manifest = buildExportManifest({
    stratifiedMeta: { id: 'stratified', version: '0.2.0' },
    state,
    env: { seed: 'seed-123', webgpu: { adapter: { name: 'Mock' }, supportedFeatures: ['timestamp'] } },
    renderer: { getShaderManifest: () => ['shader-a'] },
    strata: { getTextureInfo: () => ({ layers: 4 }) },
    simulation: {
      getContactBuffers: () => ({ capacity: 256 }),
      getArtifactMetrics: () => ({ total: 20 }),
    },
    pipeline: { getPoolSnapshot: () => ({ suppressed: false }) },
    controls: [
      { key: 'spawnCount' },
      { key: 'maxArtifacts' },
      { key: 'exportPNG' },
    ],
    extra: { asset: { type: 'png' } },
  });

  assert.equal(manifest.id, 'stratified');
  assert.equal(manifest.version, '0.2.0');
  assert.equal(manifest.frames, 12);
  assert.equal(manifest.seed, 'seed-123');
  assert.equal(manifest.controls.spawnCount, state.spawnCount);
  assert.deepEqual(manifest.asset.type, 'png');
  assert.deepEqual(manifest.pool, { suppressed: false });
});

test('buildPoolSnapshot falls back to state when pipeline snapshot unavailable', () => {
  const snapshot = buildPoolSnapshot(null, {
    poolSuppressed: true,
    poolSuppressedReason: 'full',
    maxArtifacts: 10,
    poolEvents: [{ type: 'wave', frame: 1 }],
  });
  assert.equal(snapshot.suppressed, true);
  assert.equal(snapshot.reason, 'full');
  assert.equal(snapshot.maxArtifacts, 10);
  assert.equal(snapshot.events.length, 1);
});
