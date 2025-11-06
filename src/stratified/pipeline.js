const MATERIAL_KEYS = ['box', 'wrapper', 'coin'];
const SPAWN_SPREAD_X = 0.45;
const SPAWN_HEIGHT_BASE = 0.9;
const SPAWN_HEIGHT_JITTER = 0.08;
const SPAWN_DEPTH_OFFSET = 0;
export const POOL_EVENT_LIMIT = 8;

export class StratifiedPipeline {
  constructor({ env, controller, factory, renderer, simulation, strata, strataExtent = 0.65 }) {
    this.env = env;
    this.controller = controller;
    this.factory = factory;
    this.renderer = renderer;
    this.simulation = simulation;
    this.strata = strata;
    this.state = controller.getState();
    this.contactsBound = false;
    this.strataExtent = strataExtent;
    this.lastContactCount = 0;
    this.latestMetrics = null;
  }

  tick(dt) {
    const { state } = this;
    const slowFactor = state.slowMoFactor ?? 1;
    const simDt = state.slowMotion ? dt * slowFactor : dt;

    if (state.spawnCadence > 0) {
      state.spawnTimer += simDt;
      if (state.spawnTimer >= state.spawnCadence) {
        state.spawnTimer = 0;
        state.pendingStreamWave = true;
      }
    }

    if (state.needsRespawn) {
      this.rebuildArtifacts({ preserveStrata: false });
    } else if (state.pendingStreamWave) {
      this.spawnWave();
      state.pendingStreamWave = false;
    }

    this.renderer.setGeometryBuffers(this.simulation.getGeometryBuffers());

    const frameUniforms = this.env.webgpu?.frameUniforms;
    const fixedDelta = state.fixedDelta;
    const maxAccum = fixedDelta * state.maxSubsteps;
    state.accumulator = Math.min(state.accumulator + simDt, maxAccum);
    let steps = 0;
    let bakeBudget = state.forceBakeFrames;
    let simStepMs = 0;

    while (state.accumulator >= fixedDelta) {
      state.accumulator -= fixedDelta;
      state.time += fixedDelta;
      state.frame += 1;

      frameUniforms?.updateFrame?.({ time: state.time, deltaTime: fixedDelta, frame: state.frame });

      const simStart = performance?.now?.() ?? Date.now();
      const restThreshold = bakeBudget > 0 ? Math.max(0.2, state.restThreshold * 50) : state.restThreshold;
      this.simulation.step({
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

      this.strata.accumulate({
        contactBuffers: this.simulation.getContactBuffers(),
        extent: this.strataExtent,
        pointSize: 3.5,
        intensity: state.strataIntensity,
        decay: state.strataAging,
        time: state.time,
      });
      this.lastContactCount = this.strata.getLastContactCount?.() ?? this.lastContactCount;
      steps += 1;
      if (steps >= state.maxSubsteps) {
        break;
      }
    }

    state.forceBakeFrames = Math.max(0, bakeBudget);

    const artifactStats = this.simulation.getArtifactMetrics?.();
    const poolSnapshot = this.getPoolSnapshot();
    const contactBuffers = this.simulation.getContactBuffers();
    const timings = this.simulation.getTimings?.();

    this.latestMetrics = {
      simStepMs,
      steps,
      artifact: artifactStats,
      pool: poolSnapshot,
      timings,
      contacts: {
        lastFrame: this.lastContactCount,
        capacity: contactBuffers?.capacity ?? 0,
        avgContacts: artifactStats?.avgContacts ?? 0,
        avgImpulse: artifactStats?.avgImpulse ?? 0,
      },
    };

    return this.latestMetrics;
  }

  getMetrics() {
    return this.latestMetrics;
  }

  rebuildArtifacts({ preserveStrata = false, fillMode = 'spawn' } = {}) {
    const { state } = this;
    state.needsRespawn = false;
    state.pendingStreamWave = false;
    this.factory.reset();
    const targetCount = fillMode === 'max' ? state.maxArtifacts : state.spawnCount;
    const spawnTotal = Math.min(targetCount, state.maxArtifacts);
    const batch = this.spawnArtifactBatch(spawnTotal);
    const appended = this.applyArtifactBatch(batch, { reset: true });
    this.factory.reset();
    if (!appended) return 0;
    if (!preserveStrata) {
      this.strata.clear();
      state.streamCount = 0;
      state.scrollOffset = 0;
      state.compactionLevel = 0;
    } else {
      state.streamCount += 1;
      state.compactionLevel = Math.min(1, state.compactionLevel + state.compactionRate);
    }
    this.controller.syncActivePalette();
    this.clearSpawnSuppression();
    return appended;
  }

  spawnWave() {
    const { state, simulation } = this;
    const target = Math.min(state.spawnCount, state.maxArtifacts);
    if (target <= 0) return 0;

    const settledSlotHelper = null;
    const rewriteHelper = null;
    const metrics = simulation.getArtifactMetrics?.() || {};
    const active = metrics.total ?? 0;
    let capacity = Math.max(0, state.maxArtifacts - active);
    state.debugPoolActive = active;
    state.debugPoolCapacity = capacity;
    state.debugSettledSlots = 0;
    let settledSlots = [];
    let reused = 0;

    // Diagnostics: disable slot rewrites so every wave forces fresh geometry.
    if (capacity <= 0) {
      this.simulation.resetGeometry?.();
      capacity = state.maxArtifacts;
    }

    let remaining = Math.max(0, target - reused);
    let appended = 0;
    if (remaining > 0) {
      if (capacity <= 0) {
        this.suppressSpawns('Artifact pool full — waiting for settled slots');
      } else {
        const appendCount = Math.min(remaining, capacity);
        this.factory.reset();
        const appendBatch = this.spawnArtifactBatch(appendCount);
        appended = this.applyArtifactBatch(appendBatch, { reset: false });
        this.factory.reset();
        remaining = Math.max(0, remaining - appended);
        if (appended < appendCount) {
          this.suppressSpawns('Spawn append incomplete — check console');
        }
      }
    }

    const totalSpawned = reused + appended;
    if (totalSpawned > 0) {
      state.streamCount += 1;
      state.compactionLevel = Math.min(1, state.compactionLevel + state.compactionRate);
      this.controller.syncActivePalette();
      this.clearSpawnSuppression();
      this.logPoolEvent('wave', { reused, appended });
      if (remaining > 0) {
        this.suppressSpawns('Pool deficit — recycle to finish wave');
      }
    } else {
      this.suppressSpawns('Spawn wave skipped — pool locked');
    }
    return totalSpawned;
  }

  recyclePool({ preserveStrata = true } = {}) {
    this.controller.setStatus('Recycling artifact pool…', 2);
    this.rebuildArtifacts({ preserveStrata, fillMode: 'max' });
    this.clearSpawnSuppression();
    this.state.spawnTimer = 0;
    this.logPoolEvent('manual-recycle');
  }

  spawnArtifactBatch(count) {
    const weights = this.buildMaterialWeights(this.state.materialWeights);
    const spawnOptions = {
      classId: 'circle',
      overrides: {
        radius: 0.034,
        thickness: 0.001,
        segments: 180,
      },
    };
    if (weights) {
      spawnOptions.weights = weights;
    }
    for (let i = 0; i < count; i += 1) {
      this.factory.spawn(spawnOptions);
    }
    const batch = {
      artifacts: this.factory.artifacts.slice(),
      meshViews: this.factory.staging.mesh.getViews(),
      constraintViews: this.factory.staging.constraints.getViews(),
    };
    this.scatterArtifactBatch(batch);
    this.recordSpawnDiagnostics(batch);
    this.renderer.setBillboardInstances?.(this.state.debugSpawnPreview);
    return batch;
  }

  scatterArtifactBatch(batch) {
    const { artifacts, meshViews } = batch;
    const { state } = this;
    const positions = meshViews?.positions;
    if (!artifacts?.length || !positions) return;
    const rand = this.env.prng ?? Math;
    const next = () => (typeof rand.nextFloat === 'function' ? rand.nextFloat() : Math.random());
    const preview = [];
    state.debugSpawnPreview = preview;
    artifacts.forEach((artifact, index) => {
      const range = artifact?.ranges?.meshRange;
      if (!range?.vertexCount) return;
      const spawnT = (index + next()) / Math.max(artifacts.length, 1);
      const jitterX = (next() * 2 - 1) * SPAWN_SPREAD_X;
      const spawnX = jitterX * (0.5 + spawnT * 0.5);
      const spawnY = SPAWN_HEIGHT_BASE + (next() * 2 - 1) * SPAWN_HEIGHT_JITTER;
      const spawnZ = SPAWN_DEPTH_OFFSET;
      this.translateVertices(positions, range, spawnX, spawnY, spawnZ, { flattenZ: false });
      preview.push({
        x: spawnX,
        y: spawnY,
        z: spawnZ,
        r: artifact?.descriptor?.params?.radius ?? 0.03,
      });
    });
  }

  recordSpawnDiagnostics(batch) {
    const { state } = this;
    if (!batch?.artifacts?.length) return;
    const builders = new Set();
    let vertexSum = 0;
    let indexSum = 0;
    batch.artifacts.forEach((artifact) => {
      if (artifact?.descriptor?.builder) {
        builders.add(artifact.descriptor.builder);
      }
      const meshRange = artifact?.ranges?.meshRange;
      if (meshRange) {
        vertexSum += meshRange.vertexCount ?? 0;
        indexSum += meshRange.indexCount ?? 0;
      }
    });
    const count = batch.artifacts.length;
    state.debugSpawnBuilders = Array.from(builders);
    state.debugSpawnVerts = count > 0 ? Math.round(vertexSum / count) : 0;
    state.debugSpawnIndices = count > 0 ? Math.round(indexSum / count) : 0;
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info('[Stratified] spawn batch', {
        count,
        builders: state.debugSpawnBuilders,
        avgVerts: state.debugSpawnVerts,
        avgIndices: state.debugSpawnIndices,
      });
    }
  }

  translateVertices(buffer, meshRange, tx, ty, tz, { flattenZ = false } = {}) {
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

  applyArtifactBatch(batch, { reset = false } = {}) {
    const { simulation, strata, renderer } = this;
    if (!batch?.artifacts?.length) return 0;
    let appended = 0;
    try {
      if (typeof simulation.appendFromStaging === 'function') {
        appended =
          simulation.appendFromStaging(batch.meshViews, batch.constraintViews, batch.artifacts, { reset }) || 0;
      } else {
        simulation.uploadFromStaging(batch.meshViews, batch.constraintViews, batch.artifacts);
        appended = batch.artifacts.length;
      }
    } catch (error) {
      console.error('Artifact append failed', error);
      this.controller.setStatus('Spawn failed — check console output', 4);
      appended = 0;
    }

    if (appended === 0 && reset) {
      console.warn('Streaming append unavailable, falling back to full respawn upload');
      simulation.uploadFromStaging(batch.meshViews, batch.constraintViews, batch.artifacts);
      appended = batch.artifacts.length;
      this.state.pendingStreamWave = false;
    }

    if (appended > 0) {
      renderer.setGeometryBuffers(simulation.getGeometryBuffers());
      if (!this.contactsBound) {
        strata.bindContacts(simulation.getContactBuffers());
        this.contactsBound = true;
      }
    }

    return appended;
  }

  logPoolEvent(type, details = {}) {
    const { state, simulation } = this;
    if (!Array.isArray(state.poolEvents)) {
      state.poolEvents = [];
    }
    const metrics = simulation.getArtifactMetrics?.() || {};
    const event = {
      type,
      frame: state.frame,
      time: Number(state.time.toFixed(3)),
      reason: details.reason ?? null,
      reused: details.reused ?? 0,
      appended: details.appended ?? 0,
      total: metrics.total ?? 0,
    };
    state.poolEvents.push(event);
    while (state.poolEvents.length > POOL_EVENT_LIMIT) {
      state.poolEvents.shift();
    }
  }

  suppressSpawns(reason = 'Artifact pool full') {
    const { state } = this;
    if (state.poolSuppressed) return;
    state.poolSuppressed = true;
    state.poolSuppressedReason = reason;
    state.poolSuppressedSince = performance?.now?.() ?? Date.now();
    this.controller.setStatus(reason, 3);
    this.logPoolEvent('suppress', { reason });
  }

  clearSpawnSuppression() {
    const { state } = this;
    if (!state.poolSuppressed) return;
    state.poolSuppressed = false;
    state.poolSuppressedReason = '';
    state.poolSuppressedSince = 0;
    this.logPoolEvent('resume');
  }

  buildMaterialWeights(source) {
    if (!source) return null;
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

  getPoolSnapshot() {
    const { state } = this;
    const events = Array.isArray(state.poolEvents) ? state.poolEvents.slice(-POOL_EVENT_LIMIT) : [];
    return {
      suppressed: state.poolSuppressed,
      reason: state.poolSuppressedReason,
      events: events.map((event) => ({ ...event })),
      maxArtifacts: state.maxArtifacts,
    };
  }
}
