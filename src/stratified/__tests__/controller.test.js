import test from 'node:test';
import assert from 'node:assert/strict';

import { StratifiedController, OPTIMAL_DEFAULTS } from '../controller.js';

function createController(overrides = {}) {
  const updates = [];
  const rendererCalls = { resolution: [] };
  const env = {
    seed: 'unit-test-seed',
    controls: {
      update: (key, value) => updates.push({ key, value }),
    },
  };
  const renderer = {
    setPixelResolution: (...args) => rendererCalls.resolution.push(args),
    setDitherOptions: () => {}
  };
  const basePalette = {
    primary: [0, 0, 0, 1],
    secondary: [0, 0, 0, 1],
    shadow: [0, 0, 0, 1],
    sediment: [0, 0, 0, 1],
  };

  const controller = new StratifiedController({
    env,
    renderer,
    streamConfig: { maxArtifacts: overrides.maxArtifacts ?? 128 },
    resolvePalette: overrides.resolvePalette ?? ((id) => ({ id, colors: {} })),
    paletteBase: overrides.paletteBase ?? basePalette,
    initialPaletteId: overrides.initialPaletteId ?? 'oxidized',
    defaults: overrides.defaults ?? OPTIMAL_DEFAULTS,
  });

  return { controller, env, rendererCalls, updates };
}

test('handleControlChange updates spawnCount and marks respawn', () => {
  const { controller } = createController();
  controller.handleControlChange('spawnCount', 42);
  const state = controller.getState();

  assert.equal(state.spawnCount, 42);
  assert.equal(state.needsRespawn, true);
});

test('handleControlChange updates palette via resolver hook', () => {
  const palette = { id: 'aurora', colors: {} };
  const linearPalette = {
    primary: [1, 1, 1, 1],
    secondary: [0.5, 0.5, 0.5, 1],
    shadow: [0, 0, 0, 1],
    sediment: [0.1, 0.2, 0.3, 1],
  };
  const { controller } = createController({
    resolvePalette: (id) => (id === 'aurora' ? palette : { id: 'fallback', colors: {} }),
  });

  controller.handleControlChange('paletteId', 'aurora', { toLinearPalette: () => linearPalette });
  const state = controller.getState();

  assert.equal(state.paletteId, 'aurora');
  assert.deepEqual(state.paletteBase, linearPalette);
});

test('handleControlChange clamps pixel dimensions and calls renderer', () => {
  const { controller, rendererCalls } = createController();
  rendererCalls.resolution.length = 0;

  controller.handleControlChange('pixelWidth', 4096);
  controller.handleControlChange('pixelHeight', 32);

  const state = controller.getState();
  assert.equal(state.pixelWidth, 2048);
  assert.equal(state.pixelHeight, 64);
  assert.equal(rendererCalls.resolution.length, 2);
  assert.deepEqual(rendererCalls.resolution[0], [2048, OPTIMAL_DEFAULTS.pixelHeight]);
  assert.deepEqual(rendererCalls.resolution[1], [2048, 64]);
});
