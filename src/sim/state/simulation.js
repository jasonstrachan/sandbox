import { instantiateArtifact } from './artifact.js';
import { XPBDSolver } from '../core/solver.js';
import { SIM_DEFAULTS } from '../core/constants.js';
import { Xoshiro128 } from '../rng/xoshiro128.js';
import { getSilhouette } from '../data/canonical-silhouettes.js';
import { resolveInterMeshContacts, createContactState } from './collisions.js';
import { StrataGrid } from '../grid/strata-grid.js';
import { WarpField } from '../warp/warp-field.js';
import { DeterminismTracker } from '../debug/determinism.js';

const DEFAULT_CONTACT = {
  cellSize: 64,
  cellSizes: [64, 32],
  epsilon: 1.5,
  includeProxies: true,
  includeInterior: false,
  proxySampleLimit: 160,
  cacheTtl: 120,
  maxPairsPerBucket: 96,
  contactIterations: 6,
  contactCompliance: 0,
  friction: { static: 0.55, kinetic: 0.35 },
  slop: 0.05,
  predictiveCcd: true,
  ccdScale: 1.1,
  ccdVelocityClamp: 2200,
  enableLayeredContacts: true,
  clusterRadiusScale: 1.35,
  radiusScale: 1.4,
  minContactIterations: 2,
  maxContactIterations: 8,
  minRadiusScale: 1,
  maxRadiusScale: 1.4,
};
const DEFAULT_MAX_FRAME_DT = 1 / 30; // clamp to ~33ms to avoid runaway catch-up
const DEFAULT_MAX_CATCHUP_STEPS = 240; // cap solver work per RAF tick
const BURY_MARGIN_PX = 20;
const REST_MARGIN_PX = 5;
const COVER_GAP_TOLERANCE_PX = 6;
const BURY_SETTLE_FRAMES = 240;
const BURY_EVIDENCE_FRAMES = 120;
const SETTLE_ASPECT_THRESHOLD = 1.05;
const OFFSCREEN_MARGIN_PX = 48;
const GRID_ATTACHMENT_RAMP_FRAMES = 120;
const GRID_ATTACHMENT_RESIDUAL_FACTOR = 1.5;

export class StackSimulation {
  constructor(options = {}) {
    this.config = { ...SIM_DEFAULTS, ...options.simConfig };
    this.solver = new XPBDSolver(this.config);
    this.artifacts = [];
    this.rng = options.rng ?? new Xoshiro128(options.seed ?? 'stack');
    this.accumulator = 0;
    this.bounds = options.bounds ?? { width: 1920, height: 1080 };
    this.baseGravity = {
      x: this.config.gravity?.x ?? 0,
      y: this.config.gravity?.y ?? 0,
    };
    this.worldScale = options.worldScale ?? 0.25;
    this.gravityScale = options.gravityScale ?? 1;
    this.timeScale = options.timeScale ?? 1;
    this.environment = {
      gravity: scaleGravity(this.baseGravity, this.gravityScale, this.worldScale),
      groundY: this.bounds.height * 0.9,
    };
    this.spawnCounter = 0;
    this.frameIndex = 0;
    this.N_max = options.N_max ?? 8;
    this.spawnQueue = [];
    this.spawnHistory = [];
    this.contactConfig = { ...DEFAULT_CONTACT, ...options.contactConfig };
    this.grid = new StrataGrid({ width: this.bounds.width, height: this.bounds.height, cellSize: 36 });
    this.warp = new WarpField({ width: this.bounds.width, height: this.bounds.height, seed: options.warpSeed ?? 'warp-field' });
    const determinismOptions = resolveDeterminismOptions(options);
    this.detector = determinismOptions ? new DeterminismTracker(determinismOptions) : null;
    this.metrics = { residuals: { stretch: 0, area: 0, bend: 0 }, dropStats: [] };
    this.metrics.contactRigidity = { target: 0, applied: 0 };
    this.iterationClamp = this.config.iterations;
    this.capacity = { base: this.N_max, dynamic: this.N_max, locked: false };
    this.remnants = [];
    this.maxFrameDt = options.maxFrameDt ?? DEFAULT_MAX_FRAME_DT;
    this.maxCatchupSteps = options.maxCatchupSteps ?? DEFAULT_MAX_CATCHUP_STEPS;
    this.gridAttachmentRampFrames = options.gridAttachmentRampFrames ?? GRID_ATTACHMENT_RAMP_FRAMES;
    this.buryEvidenceFrames = options.buryEvidenceFrames ?? BURY_EVIDENCE_FRAMES;
    this.gridAttachmentResidualFactor = options.gridAttachmentResidualFactor ?? GRID_ATTACHMENT_RESIDUAL_FACTOR;
    this.airDrag = Math.max(0, options.airDrag ?? 0);
    this.terminalVelocity = options.terminalVelocity ?? 1600;
    this.restitution = clamp01(options.restitution ?? 0.2);
    this.settleBias = Math.max(0, options.settleBias ?? 0);
    this.impactShake = 0;
    this.shakePhase = 0;
    this.contactState = createContactState();
  }

  setGravityScale(scale) {
    if (!Number.isFinite(scale) || scale <= 0) return;
    this.gravityScale = scale;
    this.environment.gravity = scaleGravity(this.baseGravity, this.gravityScale, this.worldScale);
  }

  setWorldScale(scale) {
    if (!Number.isFinite(scale) || scale <= 0) return;
    this.worldScale = scale;
    this.environment.gravity = scaleGravity(this.baseGravity, this.gravityScale, this.worldScale);
  }

  setTimeScale(scale) {
    if (!Number.isFinite(scale) || scale <= 0) return;
    this.timeScale = scale;
  }

  setAirDrag(coeff) {
    if (!Number.isFinite(coeff) || coeff < 0) return;
    this.airDrag = coeff;
  }

  setRestitution(value) {
    if (!Number.isFinite(value) || value < 0) return;
    this.restitution = clamp01(value);
  }

  setSettleBias(value) {
    if (!Number.isFinite(value) || value < 0) return;
    this.settleBias = value;
  }

  setBuryEvidenceFrames(value) {
    if (!Number.isFinite(value) || value < 0) return;
    this.buryEvidenceFrames = Math.max(0, Math.floor(value));
  }

  setMaxArtifacts(count, options = {}) {
    if (!Number.isFinite(count) || count <= 0) return;
    const { lock = false } = options;
    const clamped = Math.max(1, Math.floor(count));
    const prevBase = this.capacity.base;
    this.N_max = clamped;
    this.capacity.base = clamped;
    if (clamped > prevBase) {
      this.capacity.dynamic = clamped;
    } else {
      this.capacity.dynamic = Math.min(this.capacity.dynamic, clamped);
    }
    if (lock) this.capacity.locked = true;
    if (this.capacity.locked) {
      this.capacity.dynamic = this.capacity.base;
    }
    if (this.artifacts.length > clamped) {
      this.collectRemnants();
      while (this.artifacts.length > clamped) {
        const removed = this.artifacts.pop();
        if (removed) {
          const outline = captureOutline(removed);
          this.remnants.push({ outline, color: removed.renderColor ?? 'rgba(255,255,255,0.1)' });
          if (this.remnants.length > 64) this.remnants.shift();
        }
      }
    }
  }

  setBounds(width, height) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (this.bounds.width === nextWidth && this.bounds.height === nextHeight) {
      return;
    }
    this.bounds = { width: nextWidth, height: nextHeight };
    this.environment.groundY = nextHeight * 0.9;
    this.grid?.resize(nextWidth, nextHeight);
    this.warp?.resize(nextWidth, nextHeight);
  }

  spawn(params) {
    const merged = {
      position: params.position ?? {
        x: this.bounds.width * 0.5,
        y: this.bounds.height * 0.2,
      },
      rotation: params.rotation ?? 0,
      scale: params.scale ?? 1,
      shapeId: params.shapeId,
      seed: params.seed ?? `${params.shapeId}-${Date.now()}`,
      jitter: params.jitter ?? 0,
      id: params.id,
    };
    const artifact = this.spawnInternal(merged, merged.seed);
    this.updateArtifactBounds();
    return artifact;
  }

  enqueueSpawn(params, frameOffset = 0) {
    const eventId = params.id ?? `evt-${this.spawnCounter++}`;
    const event = {
      id: eventId,
      params,
      attempts: 0,
      order: this.spawnCounter,
      frame: this.frameIndex + Math.max(0, frameOffset),
    };
    this.spawnQueue.push(event);
    this.sortSpawnQueue();
    return eventId;
  }

  update(frameDt) {
    if (!Number.isFinite(frameDt) || frameDt <= 0) return;
    const clampedDt = Math.min(frameDt, this.maxFrameDt);
    const scaledDt = clampedDt * (this.timeScale ?? 1);
    this.accumulator += scaledDt;
    const stepDt = this.config.fixedDt;
    let steps = 0;
    while (this.accumulator >= stepDt && steps < this.maxCatchupSteps) {
      this.stepFixed(stepDt);
      this.accumulator -= stepDt;
      steps += 1;
    }
    if (steps === this.maxCatchupSteps) {
      this.accumulator = 0;
    }
  }

  stepFixed(dt) {
    this.frameIndex += 1;
    this.environment.groundY = this.bounds.height * 0.9;
    this.grid.beginFrame();

    this.updateArtifactBounds();
    this.drainSpawnQueue();
    this.updateArtifactBounds();

    const solverEnv = {
      gravity: this.environment.gravity,
      groundY: this.environment.groundY,
      grid: this.grid,
      sigmaRef: this.grid.maxStress || 1,
      restitution: this.restitution,
    };

    const solverEntries = [];
    this.artifacts.forEach((artifact, artifactIndex) => {
      const tier = artifact.tier ?? 'active';
      const isActive = tier === 'active';
      const iterations = this.iterationsForTier(tier);
      const energyBefore = isActive ? computeKineticEnergy(artifact) : 0;
      const nextFrame = artifact.nextUpdateFrame ?? 0;
      const hasAttachment = (artifact.attachmentWeight ?? 0) > 0;
      const shouldSolve = tier !== 'buried' || this.frameIndex >= nextFrame || hasAttachment;
      const baseBeta = artifact.material.plastic?.beta;
      const betaScale = tier === 'buried' ? 0.25 : 1;
      artifact.material.plasticRuntimeBeta = scalePlasticBeta(baseBeta, betaScale);
      solverEntries.push({
        mesh: artifact,
        artifactIndex,
        tier,
        isActive,
        iterations,
        shouldSolve,
        energyBefore,
      });
    });

    let contactDuration = 0;
    const buildContacts = (payload = {}) => {
      const start = now();
      const result = resolveInterMeshContacts(this.artifacts, this.contactConfig, this.contactState, {
        frameIndex: this.frameIndex,
        stepDt: payload.dt,
        stepIndex: payload.stepIndex,
        iteration: payload.iteration,
      });
      contactDuration += now() - start;
      return result;
    };

    const solverStart = now();
    const solverOutcome = this.solver.stepSystem({
      entries: solverEntries,
      dt,
      environment: solverEnv,
      artifacts: this.artifacts,
      contactConfig: this.contactConfig,
      contactBuilder: this.artifacts.length > 1 ? buildContacts : null,
    });
    const solverTime = now() - solverStart;
    const contactTime = contactDuration;
    if (solverOutcome?.contactStats) this.metrics.contactStats = solverOutcome.contactStats;
    this.applyAdaptiveContactRigidity();

    solverEntries.forEach((entry) => {
      if (!entry.shouldSolve) return;
      const artifact = entry.mesh;
      this.applyAirDrag(artifact, dt);
      if (entry.isActive) {
        const energyAfter = computeKineticEnergy(artifact);
        this.restoreEnergy(artifact, entry.energyBefore, energyAfter);
      }
      this.applySettleBias(artifact, dt);
      artifact.nextUpdateFrame = this.frameIndex + (entry.tier === 'buried' ? 4 : 1);
    });

    this.updateArtifactBounds();
    this.artifacts.forEach((artifact) => this.updateArtifactTier(artifact));
    this.collectRemnants();

    this.updateAttachmentWeights();
    const gridStart = now();
    this.grid.accumulateFromArtifacts(this.artifacts);
    this.grid.finalize();
    const residualBaseline = this.computeAttachmentResidualBaseline();
    const attachments = this.artifacts.filter((artifact) => this.shouldApplyGridAttachment(artifact, residualBaseline));
    if (attachments.length) {
      this.grid.applyAttachments(attachments);
    }
    const gridTime = now() - gridStart;

    this.metrics.timings = { grid: gridTime, solver: solverTime, contacts: contactTime };
    this.updateResidualMetrics();
    this.recordDeterminism();
    this.enforceBudgets();
    const decay = Math.exp(-dt * 6);
    this.impactShake *= decay;
    this.shakePhase = (this.shakePhase + dt * 90) % (Math.PI * 2);
  }

  drainSpawnQueue() {
    if (!this.spawnQueue.length) return false;
    this.sortSpawnQueue();
    let spawned = false;
    while (this.spawnQueue.length && this.spawnQueue[0].frame <= this.frameIndex) {
      const event = this.spawnQueue[0];
      if (this.countLiveArtifacts() >= this.capacity.dynamic) {
        event.frame += 1;
        event.reason = 'defer:n_max';
        break;
      }
      const candidate = this.prepareSpawn(event.params);
      if (!candidate) {
        event.attempts += 1;
        if (event.attempts > 4) {
          this.spawnHistory.push({ id: event.id, status: 'dropped', reason: 'no-clearance', frame: this.frameIndex });
          this.spawnQueue.shift();
        } else {
          event.frame = this.frameIndex + 1;
          this.sortSpawnQueue();
        }
        continue;
      }
      const artifact = this.spawnInternal(candidate, event.seed ?? `${candidate.shapeId}-${event.order}`);
      this.spawnHistory.push({ id: event.id, status: 'spawned', frame: this.frameIndex });
      this.spawnQueue.shift();
      spawned = true;
    }
    if (spawned) this.updateArtifactBounds();
    return spawned;
  }

  prepareSpawn(baseParams) {
    const silhouette = getSilhouette(baseParams.shapeId);
    if (!silhouette) return null;
    const scale = baseParams.scale ?? 1;
    const dims = {
      width: silhouette.dimensions.width * scale,
      height: silhouette.dimensions.height * scale,
    };
    const centerX = baseParams.position?.x ?? this.bounds.width * 0.5;
    const topY = baseParams.position?.y ?? this.bounds.height * 0.2;
    const attempts = 6;
    for (let i = 0; i < attempts; i += 1) {
      const jitter = (this.rng.nextFloat() - 0.5) * this.bounds.width * 0.25;
      const x = quantize(centerX + jitter, 8);
      const xMin = x - dims.width / 2;
      const xMax = x + dims.width / 2;
      const surface = this.sampleSurface(xMin, xMax);
      const maxY = Math.min(topY, surface - dims.height * 0.6);
      const minCenter = dims.height * 0.5 + 8;
      const y = Math.max(minCenter, maxY);
      const bounds = {
        minX: xMin,
        maxX: xMax,
        minY: y - dims.height / 2,
        maxY: y + dims.height / 2,
      };
      if (!this.hasClearance(bounds)) continue;
      return { ...baseParams, position: { x, y } };
    }
    return null;
  }

  sampleSurface(minX, maxX) {
    let surface = this.bounds.height * 0.2;
    this.artifacts.forEach((artifact) => {
      const bounds = artifact.bounds;
      if (!bounds) return;
      if (bounds.maxX < minX || bounds.minX > maxX) return;
      surface = Math.min(surface, bounds.minY);
    });
    return surface;
  }

  sampleCoverSurface(bounds, subject) {
    if (!bounds) return null;
    let surface = Infinity;
    this.artifacts.forEach((artifact) => {
      if (!artifact || artifact === subject) return;
      const otherBounds = artifact.bounds;
      if (!otherBounds) return;
      if (otherBounds.maxX < bounds.minX || otherBounds.minX > bounds.maxX) return;
      if (otherBounds.minY >= bounds.minY) return;
      const gap = bounds.minY - (otherBounds.maxY ?? bounds.minY);
      if (gap > COVER_GAP_TOLERANCE_PX) return;
      surface = Math.min(surface, otherBounds.minY);
    });
    return Number.isFinite(surface) ? surface : null;
  }

  countLiveArtifacts() {
    let count = 0;
    this.artifacts.forEach((artifact) => {
      if ((artifact.tier ?? 'active') !== 'buried') count += 1;
    });
    return count;
  }

  updateAttachmentWeights() {
    if (!this.artifacts?.length) return;
    const rampFrames = Math.max(1, Math.floor(this.gridAttachmentRampFrames ?? GRID_ATTACHMENT_RAMP_FRAMES));
    this.artifacts.forEach((artifact) => {
      if (!artifact) return;
      if ((artifact.tier ?? 'active') !== 'buried') {
        artifact.attachmentWeight = 0;
        return;
      }
      const entered = artifact.tierEnteredAt ?? this.frameIndex;
      const framesInTier = this.frameIndex - entered;
      const t = clamp01(framesInTier / rampFrames);
      artifact.attachmentWeight = t;
    });
  }

  computeAttachmentResidualBaseline() {
    if (!this.artifacts?.length) return null;
    let stretch = 0;
    let area = 0;
    let count = 0;
    this.artifacts.forEach((artifact) => {
      if (!artifact) return;
      const tier = artifact.tier ?? 'active';
      if (tier === 'buried') return;
      const residuals = getArtifactResiduals(artifact);
      if (!Number.isFinite(residuals.stretch) && !Number.isFinite(residuals.area)) return;
      stretch += residuals.stretch || 0;
      area += residuals.area || 0;
      count += 1;
    });
    if (count === 0) return null;
    return {
      stretch: stretch / count,
      area: area / count,
    };
  }

  shouldApplyGridAttachment(artifact, baseline) {
    if (!artifact) return false;
    if ((artifact.tier ?? 'active') !== 'buried') return false;
    if ((artifact.attachmentWeight ?? 0) <= 0) return false;
    if (!baseline) return true;
    const factor = this.gridAttachmentResidualFactor ?? GRID_ATTACHMENT_RESIDUAL_FACTOR;
    if (!Number.isFinite(factor) || factor <= 0) return true;
    const residuals = getArtifactResiduals(artifact);
    if (baseline.stretch > 0 && residuals.stretch > baseline.stretch * factor) return false;
    if (baseline.area > 0 && residuals.area > baseline.area * factor) return false;
    return true;
  }

  hasClearance(candidateBounds) {
    const margin = 12;
    return this.artifacts.every((artifact) => {
      const bounds = artifact.bounds;
      if (!bounds) return true;
      const separatedHorizontally = candidateBounds.maxX + margin < bounds.minX || candidateBounds.minX - margin > bounds.maxX;
      const separatedVertically = candidateBounds.maxY + margin < bounds.minY || candidateBounds.minY - margin > bounds.maxY;
      return separatedHorizontally || separatedVertically;
    });
  }

  updateArtifactBounds() {
    this.artifacts.forEach((artifact) => {
      artifact.bounds = computeBounds(artifact);
    });
  }

  updateResidualMetrics() {
    const aggregate = { stretch: 0, area: 0, bend: 0 };
    let count = 0;
    this.artifacts.forEach((artifact) => {
      aggregate.stretch += rms(artifact.debug.stretchResiduals);
      aggregate.area += rms(artifact.debug.areaResiduals);
      aggregate.bend += rms(artifact.debug.bendResiduals);
      count += 1;
    });
    if (count > 0) {
      this.metrics.residuals = {
        stretch: aggregate.stretch / count,
        area: aggregate.area / count,
        bend: aggregate.bend / count,
      };
    }
  }

  applyAdaptiveContactRigidity() {
    const stats = this.metrics?.contactStats;
    if (!stats) return;
    const maxPenetration = stats.maxPenetration ?? 0;
    const target = clamp01((maxPenetration - 2) / 10);
    this.metrics.contactRigidity = { target, applied: target };
    const baseConfig = this.contactConfig ?? {};
    const tuned = {
      contactIterations: Math.round(lerp(baseConfig.minContactIterations ?? 2, baseConfig.maxContactIterations ?? 8, target)),
      radiusScale: lerp(baseConfig.minRadiusScale ?? 1, baseConfig.maxRadiusScale ?? 1.4, target),
    };
    this.contactConfig = { ...baseConfig, ...tuned };
  }

  recordDeterminism() {
    if (!this.detector) return;
    const buffer = [];
    this.artifacts.forEach((artifact) => {
      artifact.particles.forEach((particle) => {
        buffer.push(Math.fround(particle.position.x), Math.fround(particle.position.y));
      });
    });
    this.grid.getColumns().forEach((column) => {
      buffer.push(Math.fround(column.mass), Math.fround(column.height));
    });
    this.detector.record(this.frameIndex, buffer);
  }

  iterationsForTier(tier) {
    const base = this.iterationClamp;
    if (tier === 'buried') return Math.max(3, Math.floor(base * 0.5));
    if (tier === 'resting') return Math.max(4, Math.floor(base * 0.75));
    return base;
  }

  updateArtifactTier(artifact) {
    const bounds = artifact.bounds;
    if (!bounds) return;
    const surface = this.grid.sampleSurfaceRange(bounds.minX, bounds.maxX);
    const coverSurface = this.sampleCoverSurface(bounds, artifact);
    const previous = artifact.tier ?? 'active';
    const restingAge = previous === 'resting' ? this.frameIndex - (artifact.tierEnteredAt ?? this.frameIndex) : 0;
    const readyForBurial = previous === 'buried' || restingAge >= BURY_SETTLE_FRAMES;
    let tier = previous;
    const coverBuried = Number.isFinite(coverSurface) && bounds.minY > coverSurface + BURY_MARGIN_PX;
    const strataBuried = bounds.minY > surface + BURY_MARGIN_PX;
    const deepStrataBuried = bounds.minY > surface + BURY_MARGIN_PX * 2;
    const stronglyBuried = coverBuried || deepStrataBuried;
    const evidenceRequired = Math.max(1, Math.floor(this.buryEvidenceFrames ?? BURY_EVIDENCE_FRAMES));
    const prevEvidence = artifact.burialEvidenceFrames ?? 0;
    const nextEvidence = stronglyBuried ? Math.min(evidenceRequired, prevEvidence + 1) : Math.max(0, prevEvidence - 1);
    artifact.burialEvidenceFrames = nextEvidence;
    const hasEvidence = nextEvidence >= evidenceRequired;
    if (stronglyBuried && readyForBurial && hasEvidence) tier = 'buried';
    else if (bounds.maxY > surface - REST_MARGIN_PX || coverBuried || strataBuried) tier = 'resting';
    else tier = 'active';
    const hasActiveJoints = artifact.topology?.joints?.some((joint) => !joint.broken);
    if (hasActiveJoints && tier === 'buried' && previous !== 'buried') tier = 'resting';
    if (previous === 'buried') tier = 'buried';

    if (tier !== previous) {
      artifact.tier = tier;
      artifact.tierEnteredAt = this.frameIndex;
      if (tier === 'buried') {
        artifact.attachmentWeight = 0;
      }
      if (tier !== 'buried') {
        artifact.burialEvidenceFrames = 0;
      }
    }

    if (tier === 'buried') {
      artifact.opacity = 1;
    } else if (tier === 'resting') {
      artifact.opacity = 0.85;
    } else {
      artifact.opacity = 1;
    }

    if (tier !== 'buried') {
      artifact.nextUpdateFrame = this.frameIndex + 1;
    }
    artifact.renderColor = this.computePaletteColor(artifact, surface);

    if (artifact.dropTest && !artifact.dropTest.recorded) {
      const groundY = this.environment.groundY ?? this.bounds.height * 0.9;
      const epsilon = 1;
      if ((bounds.maxY ?? Infinity) >= groundY - epsilon) {
        artifact.dropTest.recorded = true;
        const dropHeight =
          artifact.dropTest.height ?? Math.max(0, groundY - Math.min(bounds.minY ?? groundY, groundY));
        this.pushDropStat({
          shapeId: artifact.shapeId,
          height: dropHeight,
          time: artifact.age,
        });
      }
    }
  }

  pushDropStat(sample) {
    if (!sample) return;
    if (!this.metrics.dropStats) this.metrics.dropStats = [];
    this.metrics.dropStats.unshift(sample);
    if (this.metrics.dropStats.length > 5) {
      this.metrics.dropStats.pop();
    }
    const normalized = clamp01((sample.height ?? 0) / Math.max(1, this.bounds.height));
    this.impactShake = Math.min(1.5, this.impactShake + normalized * 0.8);
  }

  applyAirDrag(artifact, dt) {
    if (!artifact || !artifact.particles?.length) return;
    if (!Number.isFinite(this.airDrag) || this.airDrag <= 0) return;
    const terminal = this.terminalVelocity ?? 1600;
    const terminalSq = terminal * terminal;
    let shouldApply = artifact.tier !== 'active';
    if (!shouldApply) {
      for (let i = 0; i < artifact.particles.length; i += 1) {
        const particle = artifact.particles[i];
        const speedSq = particle.velocity.x * particle.velocity.x + particle.velocity.y * particle.velocity.y;
        if (speedSq > terminalSq) {
          shouldApply = true;
          break;
        }
      }
    }
    if (!shouldApply) return;
    const axial = Math.exp(-this.airDrag * dt);
    const lateral = Math.exp(-this.airDrag * dt * 0.5);
    artifact.particles.forEach((particle) => {
      if (particle.invMass === 0 || particle.pinned) return;
      particle.velocity.x *= lateral;
      particle.velocity.y *= axial;
    });
  }

  applySettleBias(artifact, dt) {
    if (!artifact || !artifact.particles?.length) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (!Number.isFinite(this.settleBias) || this.settleBias <= 0) return;
    const bounds = artifact.bounds ?? computeBounds(artifact);
    if (!bounds) return;
    const height = Math.max(bounds.height ?? 0, 1e-3);
    const width = Math.max(bounds.width ?? 0, 1e-3);
    if (height <= width * SETTLE_ASPECT_THRESHOLD) return;
    const aspectRatio = height / width;
    const aspectFactor = clamp01((aspectRatio - 1) / aspectRatio);
    if (aspectFactor <= 0) return;
    const centerX = (bounds.minX + bounds.maxX) * 0.5;
    const midX = this.bounds.width * 0.5;
    const leftSurface = this.grid.sampleSurfaceRange(bounds.minX - width * 0.5, centerX);
    const rightSurface = this.grid.sampleSurfaceRange(centerX, bounds.maxX + width * 0.5);
    let direction = 0;
    if (Number.isFinite(leftSurface) && Number.isFinite(rightSurface) && Math.abs(leftSurface - rightSurface) > 1) {
      direction = leftSurface > rightSurface ? -1 : 1;
    } else {
      direction = centerX <= midX ? -1 : 1;
    }
    const slopeFactor = clamp01(Math.abs((leftSurface ?? rightSurface) - (rightSurface ?? leftSurface)) / height);
    const invHeight = 1 / height;
    const tierScale = artifact.tier === 'active' ? 1 : 0.45;
    const biasScale = this.settleBias * aspectFactor * tierScale * (0.4 + slopeFactor * 0.6);
    artifact.particles.forEach((particle) => {
      if (particle.invMass === 0 || particle.pinned) return;
      const normalizedY = clamp01((particle.position.y - bounds.minY) * invHeight);
      if (normalizedY <= 0) return;
      const leverage = normalizedY - 0.5;
      if (Math.abs(leverage) <= 1e-3) return;
      const bias = direction * biasScale * leverage;
      const delta = bias * dt;
      particle.velocity.x += bias * dt;
      particle.position.x += delta;
      particle.prevPosition.x += delta;
    });
  }

  restoreEnergy(artifact, before, after) {
    if (!artifact || before <= 0 || after <= 0) return;
    const ratio = Math.min(before / after, 1.8);
    if (ratio <= 1.01) return;
    const scale = Math.sqrt(ratio);
    artifact.particles.forEach((particle) => {
      if (particle.invMass === 0 || particle.pinned) return;
      particle.velocity.x *= scale;
      particle.velocity.y *= scale;
    });
  }

  getShakeOffset() {
    if (!this.impactShake || this.impactShake <= 1e-3) return { x: 0, y: 0 };
    const magnitude = this.impactShake * 6;
    const phase = this.shakePhase;
    return {
      x: Math.sin(phase * 1.7) * magnitude,
      y: Math.cos(phase * 1.3) * magnitude * 0.7,
    };
  }

  enforceBudgets() {
    const timings = this.metrics.timings ?? {};
    const solverTime = timings.solver ?? 0;
    const gridTime = timings.grid ?? 0;

    if (solverTime > 4 && this.iterationClamp > 4) {
      this.iterationClamp -= 1;
    } else if (solverTime < 3 && this.iterationClamp < this.config.iterations) {
      this.iterationClamp += 1;
    }

    if (!this.capacity.locked) {
      if (solverTime > 4 && this.capacity.dynamic > 4) {
        this.capacity.dynamic -= 1;
      } else if (solverTime < 3 && this.capacity.dynamic < this.capacity.base) {
        this.capacity.dynamic += 1;
      }
    } else {
      this.capacity.dynamic = this.capacity.base;
    }

    if (gridTime > 2 && this.grid.creepIterations > 1) {
      this.grid.creepIterations -= 1;
    } else if (gridTime < 1.5 && this.grid.creepIterations < 3) {
      this.grid.creepIterations += 1;
    }
  }

  computePaletteColor(artifact, surface) {
    const bounds = artifact.bounds;
    if (!bounds) return 'rgba(255,255,255,0.2)';
    const depth = clamp01((surface - bounds.minY) / this.bounds.height);
    const hue = ((artifact.material.baseHue ?? 0) * 360 + 360) % 360;
    const stressSample = this.grid.sampleStress(bounds.minX + bounds.width * 0.5);
    const chroma = clamp01(0.35 + stressSample * 1.2);
    const value = clamp01(0.25 + (1 - depth) * 0.6);
    return `hsla(${hue.toFixed(2)}, ${Math.round(chroma * 100)}%, ${Math.round(value * 100)}%, ${artifact.opacity ?? 1})`;
  }

  collectRemnants() {
    if (!this.artifacts.length) return;
    const removalList = [];
    this.artifacts.forEach((artifact) => {
      if (!artifact?.bounds) return;
      if (isOffscreen(artifact.bounds, this.bounds, OFFSCREEN_MARGIN_PX)) {
        removalList.push(artifact);
      }
    });

    const convertToRemnant = (artifact) => {
      const outline = captureOutline(artifact);
      this.remnants.push({ outline, color: artifact.renderColor ?? 'rgba(255,255,255,0.1)' });
      if (this.remnants.length > 64) this.remnants.shift();
      const idx = this.artifacts.indexOf(artifact);
      if (idx >= 0) this.artifacts.splice(idx, 1);
    };

    removalList.forEach((artifact) => convertToRemnant(artifact));
    if (this.artifacts.length <= this.capacity.base) return;

    const buriedOffscreen = this.artifacts
      .filter((artifact) => artifact.tier === 'buried' && artifact.bounds && isOffscreen(artifact.bounds, this.bounds, OFFSCREEN_MARGIN_PX));
    buriedOffscreen.sort((a, b) => (a.bounds?.minY ?? 0) - (b.bounds?.minY ?? 0));
    while (this.artifacts.length > this.capacity.base && buriedOffscreen.length) {
      const artifact = buriedOffscreen.shift();
      convertToRemnant(artifact);
    }
  }

  spawnInternal(spawnParams, seedOverride) {
    const spawnRng = this.rng.clone();
    spawnRng.setSeed(seedOverride ?? `${spawnParams.shapeId}-${this.spawnCounter++}`);
    const artifact = instantiateArtifact(spawnParams, { rng: spawnRng });
    artifact.tier = 'active';
    artifact.opacity = 1;
    artifact.nextUpdateFrame = this.frameIndex;
    artifact.bounds = computeBounds(artifact);
    artifact.dropTest = makeDropTest(artifact, this.environment.groundY ?? this.bounds.height * 0.9);
    this.artifacts.push(artifact);
    // TEMP: no initial attachment for active meshes
    // this.grid?.applyAttachments([artifact]);
    return artifact;
  }

  sortSpawnQueue() {
    this.spawnQueue.sort((a, b) => {
      if (a.frame === b.frame) return a.order - b.order;
      return a.frame - b.frame;
    });
  }

  reset() {
    this.artifacts = [];
    this.spawnQueue = [];
    this.spawnHistory = [];
    this.accumulator = 0;
    this.frameIndex = 0;
  }

  destroy() {
    this.detector?.flush?.();
    this.reset();
  }
}

function computeBounds(artifact) {
  if (!artifact?.particles?.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  artifact.particles.forEach((particle) => {
    if (particle.position.x < minX) minX = particle.position.x;
    if (particle.position.x > maxX) maxX = particle.position.x;
    if (particle.position.y < minY) minY = particle.position.y;
    if (particle.position.y > maxY) maxY = particle.position.y;
  });
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function getArtifactResiduals(artifact) {
  if (!artifact) return { stretch: 0, area: 0 };
  const debug = artifact.debug ?? {};
  const stretch = rms(debug.stretchResiduals);
  const area = rms(debug.areaResiduals);
  return {
    stretch: Number.isFinite(stretch) ? stretch : 0,
    area: Number.isFinite(area) ? area : 0,
  };
}

function quantize(value, quantum = 4) {
  return Math.round(value / quantum) * quantum;
}

function rms(values) {
  if (!values?.length) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    sum += v * v;
  }
  return Math.sqrt(sum / values.length);
}

function now() {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lerp(a, b, t) {
  if (!Number.isFinite(a)) a = 0;
  if (!Number.isFinite(b)) b = 0;
  if (!Number.isFinite(t)) t = 0;
  return a + (b - a) * t;
}

function scaleGravity(base, scale, worldScale = 1) {
  const factor = scale / Math.max(worldScale, 1e-4);
  return {
    x: (base?.x ?? 0) * factor,
    y: (base?.y ?? 0) * factor,
  };
}

function scalePlasticBeta(beta, scale) {
  if (beta == null) return beta;
  const factor = Number.isFinite(scale) ? scale : 1;
  if (typeof beta === 'number') {
    return beta * factor;
  }
  if (typeof beta !== 'object') return beta;
  const next = {};
  Object.keys(beta).forEach((key) => {
    const value = beta[key];
    next[key] = typeof value === 'number' ? value * factor : value;
  });
  return next;
}

function captureOutline(artifact) {
  const outline = artifact.particles
    .filter((particle) => particle.boundary)
    .map((particle) => ({ x: particle.position.x, y: particle.position.y }));
  return outline.length ? outline : artifact.spawn?.outline ?? [];
}

function isOffscreen(bounds, stage, margin = 0) {
  if (!bounds || !stage) return false;
  const width = stage.width ?? 0;
  const height = stage.height ?? 0;
  return (
    bounds.maxX < -margin ||
    bounds.minX > width + margin ||
    bounds.maxY < -margin ||
    bounds.minY > height + margin
  );
}

function resolveDeterminismOptions(options = {}) {
  const cfg = options?.determinism;
  if (!cfg || typeof cfg !== 'object') return null;
  if (!cfg.enabled) return null;
  const { enabled, ...rest } = cfg;
  if (options.determinismKey && rest.storageKey === undefined) {
    rest.storageKey = options.determinismKey;
  }
  return rest;
}

function makeDropTest(artifact, groundY) {
  const bounds = artifact.bounds ?? computeBounds(artifact);
  const bottom = bounds?.maxY ?? groundY;
  const height = Math.max(0, groundY - bottom);
  return {
    height,
    recorded: height === 0,
  };
}

function computeKineticEnergy(artifact) {
  if (!artifact?.particles?.length) return 0;
  let total = 0;
  artifact.particles.forEach((particle) => {
    if (particle.invMass === 0) return;
    const speedSq = particle.velocity.x * particle.velocity.x + particle.velocity.y * particle.velocity.y;
    total += 0.5 * particle.mass * speedSq;
  });
  return total;
}
