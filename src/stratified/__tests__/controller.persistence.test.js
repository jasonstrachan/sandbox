import test from 'node:test';
import assert from 'node:assert/strict';

import { StratifiedController, CONTROL_STORAGE_KEY } from '../controller.js';

const PALETTE_BASE = {
  primary: [0, 0, 0, 1],
  secondary: [1, 1, 1, 1],
  shadow: [0.5, 0.5, 0.5, 1],
  sediment: [0.25, 0.25, 0.25, 1],
};

function createController(overrides = {}) {
  const updates = [];
  const env = {
    seed: 'unit-seed',
    controls: {
      update: (key, value) => updates.push({ key, value }),
    },
  };
  const renderer = {
    setPixelResolution: () => {},
    setDitherOptions: () => {},
  };

  const controller = new StratifiedController({
    env,
    renderer,
    streamConfig: { maxArtifacts: 256 },
    resolvePalette: (id) => ({ id, colors: {} }),
    paletteBase: overrides.paletteBase ?? PALETTE_BASE,
    initialPaletteId: overrides.initialPaletteId ?? 'oxidized',
  });

  return { controller, env, updates, state: controller.getState() };
}

function withStubbedWindow(callback) {
  const originalWindow = globalThis.window;
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, value);
      },
    },
  };
  try {
    callback(() => store.get(CONTROL_STORAGE_KEY));
  } finally {
    globalThis.window = originalWindow;
  }
}

test('syncControl suppresses the next change event for the same key', () => {
  const { controller, state } = createController();
  const originalSpawn = state.spawnCount;

  controller.syncControl('spawnCount', 99);
  controller.handleControlChange('spawnCount', 42);

  assert.equal(state.spawnCount, originalSpawn, 'suppressed control change should be ignored');

  controller.handleControlChange('spawnCount', 50);
  assert.equal(state.spawnCount, 50, 'subsequent change should apply once suppression is cleared');
});

test('handleControlChange only persists whitelisted control keys', () => {
  withStubbedWindow((getSnapshot) => {
    const { controller } = createController();

    controller.handleControlChange('spawnCount', 24);
    const persistedAfterWhitelist = JSON.parse(getSnapshot());
    assert.equal(persistedAfterWhitelist.spawnCount, 24);

    controller.handleControlChange('weightBox', 0.4);
    const persistedAfterNonWhitelist = JSON.parse(getSnapshot());
    assert.ok(!Object.prototype.hasOwnProperty.call(persistedAfterNonWhitelist, 'weightBox'));
  });
});
