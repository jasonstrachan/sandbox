import test from 'node:test';
import assert from 'node:assert/strict';

import { StratifiedPipeline, POOL_EVENT_LIMIT } from '../pipeline.js';

function createPipeline(overrides = {}) {
  const state = {
    spawnCount: 4,
    maxArtifacts: 16,
    poolEvents: [],
    poolSuppressed: false,
    poolSuppressedReason: '',
    poolSuppressedSince: 0,
    needsRespawn: false,
    pendingStreamWave: false,
    spawnCadence: 0,
    spawnTimer: 0,
    fixedDelta: 1 / 60,
    maxSubsteps: 5,
    accumulator: 0,
    forceBakeFrames: 0,
    strataIntensity: 0.02,
    strataAging: 0.98,
    time: 0,
    frame: 0,
    restThreshold: 0.015,
    slowMotion: false,
    slowMoFactor: 0.25,
    gravity: [0, -981, 0],
    wobble: 0,
    damping: 0.96,
    iterations: 1,
    groundHeight: -0.3,
    groundAmp: 0.12,
    groundFreq: 1.2,
    materialWeights: { box: 1, wrapper: 1, coin: 1 },
    compactionLevel: 0,
    compactionRate: 0.01,
    scrollOffset: 0,
    debugSettledSlots: 0,
    debugPoolCapacity: 0,
    ...overrides.state,
  };

  const controller = {
    getState: () => state,
    setStatus: () => {},
  };

  const simulation = {
    getArtifactMetrics: () => ({ total: 10, avgContacts: 1.5, avgImpulse: 0.1 }),
    getGeometryBuffers: () => ({}),
    getContactBuffers: () => ({ capacity: 64, stride: 16 }),
  };

  const pipeline = new StratifiedPipeline({
    env: {},
    controller,
    factory: {
      reset() {},
      spawn() {},
      staging: {
        mesh: { getViews: () => ({ positions: new Float32Array(0) }) },
        constraints: { getViews: () => ({}) },
      },
      artifacts: [],
    },
    renderer: { setGeometryBuffers() {} },
    simulation: { ...simulation, appendFromStaging: () => 0, uploadFromStaging: () => {} },
    strata: {
      accumulate() {},
      getLastContactCount: () => 0,
      bindContacts() {},
      clear() {},
      getTextureInfo: () => ({}),
    },
  });

  return { pipeline, state };
}

test('logPoolEvent caps history to POOL_EVENT_LIMIT entries', () => {
  const { pipeline, state } = createPipeline();
  for (let i = 0; i < POOL_EVENT_LIMIT + 3; i += 1) {
    pipeline.logPoolEvent('wave', { appended: i });
  }
  assert.equal(state.poolEvents.length, POOL_EVENT_LIMIT);
  assert.equal(state.poolEvents[0].appended, 3);
  assert.equal(state.poolEvents[state.poolEvents.length - 1].appended, POOL_EVENT_LIMIT + 2);
});

test('getPoolSnapshot reflects suppression state and max artifacts', () => {
  const { pipeline, state } = createPipeline({
    state: { poolSuppressed: true, poolSuppressedReason: 'test', maxArtifacts: 42 },
  });
  pipeline.logPoolEvent('wave', { appended: 1 });
  const snapshot = pipeline.getPoolSnapshot();
  assert.equal(snapshot.suppressed, true);
  assert.equal(snapshot.reason, 'test');
  assert.equal(snapshot.maxArtifacts, 42);
  assert.equal(snapshot.events.length, 1);
});
