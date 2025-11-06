/** @typedef {import('./types.js').MeshView} MeshView */
/** @typedef {import('./types.js').ConstraintView} ConstraintView */
/** @typedef {import('./types.js').ArtifactRecord} ArtifactRecord */
/** @typedef {import('./types.js').SimulationPoolConfig} SimulationPoolConfig */
/** @typedef {import('./types.js').GeometryBuffers} GeometryBuffers */
/** @typedef {import('./types.js').BufferStats} BufferStats */
/** @typedef {import('./types.js').ContactBuffers} ContactBuffers */
/** @typedef {import('./types.js').SimulationTimings} SimulationTimings */

import {
  ARTIFACT_STATE_OFFSETS,
  ARTIFACT_STATE_SIZE,
  ARTIFACT_STATE_STRIDE,
  ARTIFACT_STATE_STRUCT_WGSL,
  writeArtifactStateEntry,
} from './artifact-state-layout.js';

const POSITION_STRIDE = 16; // vec4f per vertex
const VELOCITY_STRIDE = 16; // vec4f (xyz + mass)
const EDGE_TRIPLET_STRIDE = 3;
const HINGE_STRIDE = 4;
const SIM_UNIFORM_SIZE = 64; // paramsA + paramsB + paramsC + paramsD
const CONTACT_CAPACITY = 8192;
const CONTACT_RECORD_SIZE = 48; // three vec4f (position, normal+impulse, payload)
const CONTACT_STATE_SIZE = 16; // counter + capacity + padding
const IMPULSE_SCALE = 2048;
const PASS_LABELS = ['integrate', 'distance', 'hinge', 'shape', 'rest'];
const TIMESTAMP_SLOT_COUNT = PASS_LABELS.length * 2;
const BUFFER_SIZES = new WeakMap();
/**
 * @typedef {Object} SimulationEnv
 * @property {{ device: GPUDevice, queue: GPUQueue, frameUniforms: { buffer: GPUBuffer, size: number, updateFrame(args: { time: number, deltaTime: number, frame: number }): void, updateGravity(value: [number, number, number]): void, dispose(): void }, adapter?: GPUAdapter, clearColor?: string }} webgpu
 */
const now = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

/**
 * @param {SimulationEnv} env
 * @param {SimulationPoolConfig | null} [poolConfig=null]
 */
export function createSimulation(env, poolConfig = null) {
  const webgpu = env?.webgpu;
  if (!webgpu) throw new Error('WebGPU context missing for simulation');
  const { device, frameUniforms } = webgpu;

  /** @type {SimulationPoolConfig | null} */
  const streamingConfig = normalizePoolConfig(poolConfig);
  const streamingEnabled = Boolean(streamingConfig);

  const EMPTY_CONSTRAINT_VIEWS = /** @type {ConstraintView} */ ({
    edges: new Uint32Array(),
    edgeRestLengths: new Float32Array(),
    edgeCompliance: new Float32Array(),
    hinges: new Uint32Array(),
    hingeRestAngles: new Float32Array(),
    hingeCompliance: new Float32Array(),
  });

  function requireStreamingConfig() {
    if (!streamingConfig) {
      throw new Error('Streaming pool configuration missing');
    }
    return streamingConfig;
  }
  const materialIdMap = new Map();
  let nextMaterialId = 0;

  const simUniformBuffer = device.createBuffer({
    label: 'stratified-sim-uniforms',
    size: SIM_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const contactStateBuffer = device.createBuffer({
    label: 'stratified-contact-state',
    size: CONTACT_STATE_SIZE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  const contactDataBuffer = device.createBuffer({
    label: 'stratified-contact-data',
    size: CONTACT_CAPACITY * CONTACT_RECORD_SIZE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const contactStateInit = new Uint32Array([0, CONTACT_CAPACITY, 0, 0]);
  device.queue.writeBuffer(contactStateBuffer, 0, contactStateInit);
  const contactCounterReset = new Uint32Array([0]);

  const integrationModule = device.createShaderModule({
    label: 'stratified-integration-compute',
    code: INTEGRATION_WGSL,
  });

  const distanceConstraintModule = device.createShaderModule({
    label: 'stratified-distance-constraint',
    code: DISTANCE_CONSTRAINT_WGSL,
  });

  const hingeConstraintModule = device.createShaderModule({
    label: 'stratified-hinge-constraint',
    code: HINGE_CONSTRAINT_WGSL,
  });

  const shapeMatchModule = device.createShaderModule({
    label: 'stratified-shape-match',
    code: SHAPE_MATCH_WGSL,
  });

  const integrationLayout = device.createBindGroupLayout({
    label: 'stratified-integration-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  const distanceConstraintLayout = device.createBindGroupLayout({
    label: 'stratified-distance-constraint-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ],
  });

  const hingeConstraintLayout = device.createBindGroupLayout({
    label: 'stratified-hinge-constraint-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ],
  });

  const shapeMatchLayout = device.createBindGroupLayout({
    label: 'stratified-shape-match-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ],
  });

  const integrationPipeline = device.createComputePipeline({
    label: 'stratified-integration-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [integrationLayout] }),
    compute: { module: integrationModule, entryPoint: 'cs_integrate' },
  });

  const distanceConstraintPipeline = device.createComputePipeline({
    label: 'stratified-distance-constraint-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [distanceConstraintLayout] }),
    compute: { module: distanceConstraintModule, entryPoint: 'cs_distance' },
  });

  const hingeConstraintPipeline = device.createComputePipeline({
    label: 'stratified-hinge-constraint-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [hingeConstraintLayout] }),
    compute: { module: hingeConstraintModule, entryPoint: 'cs_hinge' },
  });

  const shapeMatchPipeline = device.createComputePipeline({
    label: 'stratified-shape-match-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [shapeMatchLayout] }),
    compute: { module: shapeMatchModule, entryPoint: 'cs_shape_match' },
  });

  const restStateModule = device.createShaderModule({
    label: 'stratified-rest-state',
    code: REST_STATE_WGSL,
  });

  const restStateLayout = device.createBindGroupLayout({
    label: 'stratified-rest-state-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });

  const restStatePipeline = device.createComputePipeline({
    label: 'stratified-rest-state-pipeline',
    layout: device.createPipelineLayout({ bindGroupLayouts: [restStateLayout] }),
    compute: { module: restStateModule, entryPoint: 'cs_rest_state' },
  });

  const supportsTimestamps = Boolean(device?.features?.has?.('timestamp-query'));
  const MAP_MODE_READ = typeof GPUMapMode !== 'undefined' ? GPUMapMode.READ : 1;
  const adapterLimits = /** @type {{ timestampPeriod?: number }} */ (webgpu?.adapter?.limits ?? {});
  const timestampPeriod = adapterLimits.timestampPeriod ?? 1;
  /** @type {Record<typeof PASS_LABELS[number], { gpu: number; cpu: number }>} */
  const timings = PASS_LABELS.reduce((acc, label) => {
    acc[label] = { gpu: 0, cpu: 0 };
    return acc;
  }, /** @type {Record<typeof PASS_LABELS[number], { gpu: number; cpu: number }>} */ ({}));
  let timestampQuerySet = null;
  const timestampReadbacks = [];
  if (supportsTimestamps) {
    timestampQuerySet = device.createQuerySet({
      label: 'stratified-sim-timestamps',
      type: 'timestamp',
      count: TIMESTAMP_SLOT_COUNT,
    });
    timestampReadbacks.push(createTimestampReadback('A'));
    timestampReadbacks.push(createTimestampReadback('B'));
  }
  const artifactMetrics = {
    total: 0,
    settled: 0,
    active: 0,
    avgImpulse: 0,
    avgContacts: 0,
  };
  let artifactStateByteLength = 0;
  let artifactStateReadback = null;
  /** @type {Array<null | {
    index: number;
    vertexOffset: number;
    vertexCount: number;
    vertexCapacity: number;
    indexOffset: number;
    indexCount: number;
    indexCapacity: number;
    edgeOffset: number;
    edgeCount: number;
    edgeCapacity: number;
    hingeOffset: number;
    hingeCount: number;
    hingeCapacity: number;
    settled: boolean;
    sequence: number;
  }>} */
  const slotStates = [];
  let slotSequenceCounter = 0;

  function createTimestampReadback(suffix) {
    const label = `stratified-timestamp-readback-${suffix}`;
    const byteLength = TIMESTAMP_SLOT_COUNT * 8;
    return {
      resolveBuffer: device.createBuffer({
        label: `${label}-resolve`,
        size: byteLength,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      }),
      readBuffer: device.createBuffer({
        label: `${label}-map`,
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      pending: false,
      count: 0,
      passes: [],
    };
  }

  function acquireReadbackBuffer() {
    if (!timestampReadbacks.length) return null;
    for (const slot of timestampReadbacks) {
      if (!slot.pending) {
        return slot;
      }
    }
    return null;
  }

  function startTimestampReadback(request) {
    if (!request) return;
    const { slot, queryCount, passes } = request;
    const byteLength = queryCount * 8;
    slot.pending = true;
    slot.count = queryCount;
    slot.passes = passes;
    slot.readBuffer
      .mapAsync(MAP_MODE_READ, 0, byteLength)
      .then(() => {
        const mapped = slot.readBuffer.getMappedRange(0, byteLength);
        const copy = mapped.slice(0);
        slot.readBuffer.unmap();
        slot.pending = false;
        const values = new BigUint64Array(copy);
        processTimestampResults(values, passes);
      })
      .catch(() => {
        slot.pending = false;
        try {
          slot.readBuffer.unmap();
        } catch {
          // buffer may not be mapped; ignore
        }
      });
  }

  function processTimestampResults(values, passes) {
    for (const pass of passes) {
      if (pass.end >= values.length || pass.start >= values.length) continue;
      const delta = values[pass.end] - values[pass.start];
      const durationMs = Number(delta) * timestampPeriod * 1e-6;
      if (Number.isFinite(durationMs)) {
        timings[pass.label].gpu = durationMs;
      }
    }
  }

  function ensureArtifactReadback(size) {
    if (!size || size <= 0) return;
    const aligned = align(size, 16);
    if (artifactStateReadback && (BUFFER_SIZES.get(artifactStateReadback.buffer) ?? 0) >= aligned) {
      return;
    }
    artifactStateReadback?.buffer.destroy?.();
    const buffer = device.createBuffer({
      label: 'stratified-artifact-state-readback',
      size: Math.max(aligned, 16),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    artifactStateReadback = { buffer, pending: false };
    BUFFER_SIZES.set(buffer, Math.max(aligned, 16));
  }

  function startArtifactStateReadback() {
    if (!artifactStateReadback?.pending || artifactStateByteLength === 0) return;
    artifactStateReadback.buffer
      .mapAsync(MAP_MODE_READ, 0, artifactStateByteLength)
      .then(() => {
        const copy = artifactStateReadback.buffer.getMappedRange(0, artifactStateByteLength).slice(0);
        artifactStateReadback.buffer.unmap();
        artifactStateReadback.pending = false;
        processArtifactStateMetrics(copy);
      })
      .catch(() => {
        artifactStateReadback.pending = false;
        try {
          artifactStateReadback.buffer.unmap();
        } catch {
          /* ignore */
        }
      });
  }

  function processArtifactStateMetrics(buffer) {
    if (!buffer) return;
    const view = new Uint32Array(buffer);
    const entryCount = Math.min(view.length / ARTIFACT_STATE_STRIDE, artifactStateByteLength / ARTIFACT_STATE_SIZE);
    if (!Number.isFinite(entryCount) || entryCount <= 0) {
      artifactMetrics.total = 0;
      artifactMetrics.settled = 0;
      artifactMetrics.active = 0;
      artifactMetrics.avgImpulse = 0;
      artifactMetrics.avgContacts = 0;
      return;
    }
    let settled = 0;
    let impulseSum = 0;
    let contactSum = 0;
    const impulseOffset = ARTIFACT_STATE_OFFSETS.totalImpulse ?? 0;
    const contactOffset = ARTIFACT_STATE_OFFSETS.contactCount ?? 1;
    const flagsOffset = ARTIFACT_STATE_OFFSETS.flags ?? 5;
    for (let i = 0; i < entryCount; i += 1) {
      const base = i * ARTIFACT_STATE_STRIDE;
      impulseSum += view[base + impulseOffset];
      contactSum += view[base + contactOffset];
      const flags = view[base + flagsOffset];
      const isSettled = (flags & 0x1) === 0x1;
      if (isSettled) {
        settled += 1;
      }
      const slot = slotStates[i];
      if (slot) {
        slot.settled = isSettled;
      }
    }
    artifactMetrics.total = entryCount;
    artifactMetrics.settled = settled;
    artifactMetrics.active = Math.max(entryCount - settled, 0);
    artifactMetrics.avgImpulse = entryCount > 0 ? (impulseSum / IMPULSE_SCALE) / entryCount : 0;
    artifactMetrics.avgContacts = entryCount > 0 ? contactSum / entryCount : 0;
  }

  function resetSlotStates() {
    slotStates.length = 0;
    slotSequenceCounter = 0;
  }

  function ensureSlotState(index) {
    if (!Number.isFinite(index) || index < 0) return null;
    if (slotStates[index]) return slotStates[index];
    const slot = {
      index,
      vertexOffset: 0,
      vertexCount: 0,
      vertexCapacity: 0,
      indexOffset: 0,
      indexCount: 0,
      indexCapacity: 0,
      edgeOffset: 0,
      edgeCount: 0,
      edgeCapacity: 0,
      hingeOffset: 0,
      hingeCount: 0,
      hingeCapacity: 0,
      settled: false,
      sequence: slotSequenceCounter++,
    };
    slotStates[index] = slot;
    return slot;
  }

  function registerSlotState(index, info = {}) {
    const slot = ensureSlotState(index);
    if (!slot) return null;
    slot.vertexOffset = info.vertexOffset ?? slot.vertexOffset ?? 0;
    slot.vertexCount = info.vertexCount ?? slot.vertexCount ?? 0;
    slot.vertexCapacity = info.vertexCapacity ?? slot.vertexCount;
    slot.indexOffset = info.indexOffset ?? slot.indexOffset ?? 0;
    slot.indexCount = info.indexCount ?? slot.indexCount ?? 0;
    slot.indexCapacity = info.indexCapacity ?? slot.indexCount;
    slot.edgeOffset = info.edgeOffset ?? slot.edgeOffset ?? 0;
    slot.edgeCount = info.edgeCount ?? slot.edgeCount ?? 0;
    slot.edgeCapacity = info.edgeCapacity ?? slot.edgeCount;
    slot.hingeOffset = info.hingeOffset ?? slot.hingeOffset ?? 0;
    slot.hingeCount = info.hingeCount ?? slot.hingeCount ?? 0;
    slot.hingeCapacity = info.hingeCapacity ?? slot.hingeCount;
    slot.settled = false;
    slot.sequence = slotSequenceCounter++;
    return slot;
  }

  function getSettledSlotIndices(limit = 0) {
    if (!limit || limit <= 0) return [];
    const entries = [];
    for (const slot of slotStates) {
      if (slot?.settled) {
        entries.push({ index: slot.index, sequence: slot.sequence });
      }
    }
    entries.sort((a, b) => a.sequence - b.sequence);
    return entries.slice(0, limit).map((entry) => entry.index);
  }

  let restPositionBuffer = null;
  let positionBuffer = null;
  let velocityBuffer = null;
  let indexBuffer = null;
  let integrationBindGroup = null;
  let distanceConstraintBindGroup = null;
  let hingeConstraintBindGroup = null;
  let shapeConstraintBindGroup = null;
  let restStateBindGroup = null;
  let vertexCount = 0;
  let indexCount = 0;
  let edgeCount = 0;
  let hingeCount = 0;
  let shapeClusterCount = 0;
  let artifactCount = 0;
  let edgeBuffer = null;
  let edgeRestComplianceBuffer = null;
  let hingeBuffer = null;
  let hingeRestComplianceBuffer = null;
  let vertexArtifactBuffer = null;
  let artifactStateBuffer = null;
  let streamingBuffersReady = false;

  /**
   * @param {MeshView} meshViews
   * @param {ConstraintView} [constraintViews]
   * @param {ArtifactRecord[]} [artifactRecords]
   */
  function uploadFromStaging(
    meshViews,
    constraintViews = EMPTY_CONSTRAINT_VIEWS,
    artifactRecords = []
  ) {
    if (streamingEnabled) {
      return appendFromStaging(meshViews, constraintViews, artifactRecords, { reset: true });
    }
    const { positions, indices } = meshViews;
    const {
      edges = new Uint32Array(),
      edgeRestLengths = new Float32Array(),
      edgeCompliance = new Float32Array(),
      hinges = new Uint32Array(),
      hingeRestAngles = new Float32Array(),
      hingeCompliance = new Float32Array(),
    } = constraintViews;

    vertexCount = Math.floor((positions?.length || 0) / 3);
    indexCount = indices?.length || 0;
    const packedEdges = packEdgeTriples(edges);
    edgeCount = Math.floor(edges.length / EDGE_TRIPLET_STRIDE);
    hingeCount = Math.floor(hinges.length / HINGE_STRIDE);
    const normalizedArtifacts = normalizeArtifacts(artifactRecords, vertexCount);
    artifactCount = vertexCount === 0 ? 0 : normalizedArtifacts.length;
    if (vertexCount === 0 || indexCount === 0 || !indices) {
      destroyBuffers();
      return;
    }

    const queue = device.queue;
    const vec4Positions = packPositions(positions);
    const vertexArtifacts = buildVertexArtifactIds(vertexCount, normalizedArtifacts);
    const artifactStateStorage = createArtifactStateStorage(normalizedArtifacts);
    restPositionBuffer = recreateBuffer(
      restPositionBuffer,
      vec4Positions.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'rest-positions'
    );
    positionBuffer = recreateBuffer(
      positionBuffer,
      vec4Positions.byteLength,
      GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'positions'
    );
    queue.writeBuffer(restPositionBuffer, 0, vec4Positions);
    queue.writeBuffer(positionBuffer, 0, vec4Positions);

    indexBuffer = recreateBuffer(
      indexBuffer,
      indices.byteLength,
      GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      'stratified-indices'
    );
    queue.writeBuffer(indexBuffer, 0, indices.buffer, indices.byteOffset, indices.byteLength);

    const masses = meshViews?.masses;
    const velocities = buildInitialVelocities(vertexCount, masses);
    velocityBuffer = recreateBuffer(
      velocityBuffer,
      velocities.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'stratified-velocities'
    );
    queue.writeBuffer(velocityBuffer, 0, velocities);

    vertexArtifactBuffer = recreateBuffer(
      vertexArtifactBuffer,
      vertexArtifacts.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'stratified-vertex-artifacts'
    );
    queue.writeBuffer(vertexArtifactBuffer, 0, vertexArtifacts);

    edgeBuffer = recreateBuffer(
      edgeBuffer,
      Math.max(packedEdges.byteLength, 16),
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'stratified-edges'
    );
    if (packedEdges.byteLength > 0) {
      queue.writeBuffer(edgeBuffer, 0, packedEdges.buffer, packedEdges.byteOffset, packedEdges.byteLength);
    }

    const edgeRestCompliance = interleaveRestCompliance(edgeRestLengths, edgeCompliance);
    edgeRestComplianceBuffer = recreateBuffer(
      edgeRestComplianceBuffer,
      Math.max(edgeRestCompliance.byteLength, 16),
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'stratified-edge-rest-compliance'
    );
    if (edgeRestCompliance.byteLength > 0) {
      queue.writeBuffer(
        edgeRestComplianceBuffer,
        0,
        edgeRestCompliance.buffer,
        edgeRestCompliance.byteOffset,
        edgeRestCompliance.byteLength
      );
    }

    hingeBuffer = recreateBuffer(
      hingeBuffer,
      Math.max(hinges.byteLength, 16),
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'stratified-hinges'
    );
    if (hinges.byteLength > 0) {
      queue.writeBuffer(hingeBuffer, 0, hinges.buffer, hinges.byteOffset, hinges.byteLength);
    }

    const hingeRestCompliance = interleaveRestCompliance(hingeRestAngles, hingeCompliance);
    hingeRestComplianceBuffer = recreateBuffer(
      hingeRestComplianceBuffer,
      Math.max(hingeRestCompliance.byteLength, 16),
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      'stratified-hinge-rest-compliance'
    );
    if (hingeRestCompliance.byteLength > 0) {
      queue.writeBuffer(
        hingeRestComplianceBuffer,
        0,
        hingeRestCompliance.buffer,
        hingeRestCompliance.byteOffset,
        hingeRestCompliance.byteLength
      );
    }

    const artifactStateBytes = artifactStateStorage.byteLength || ARTIFACT_STATE_SIZE;
    artifactStateByteLength = artifactStateBytes;
    ensureArtifactReadback(artifactStateByteLength);
    artifactMetrics.total = artifactCount;
    artifactMetrics.active = artifactCount;
    artifactMetrics.settled = 0;
    artifactMetrics.avgImpulse = 0;
    artifactMetrics.avgContacts = 0;
    artifactStateBuffer = recreateBuffer(
      artifactStateBuffer,
      Math.max(artifactStateBytes, 16),
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      'stratified-artifact-state'
    );
    if (artifactStateBytes > 0) {
      queue.writeBuffer(artifactStateBuffer, 0, artifactStateStorage);
    }

    if (artifactCount > 0) {
      resetSlotStates();
      normalizedArtifacts.forEach((artifact, index) => {
        const meshRange = artifact?.ranges?.meshRange;
        if (!meshRange) return;
        const constraintRange = artifact?.ranges?.constraintRange || {};
        registerSlotState(index, {
          vertexOffset: meshRange.vertexOffset ?? 0,
          vertexCount: meshRange.vertexCount ?? 0,
          vertexCapacity: meshRange.vertexCount ?? 0,
          indexOffset: meshRange.indexOffset ?? 0,
          indexCount: meshRange.indexCount ?? 0,
          indexCapacity: meshRange.indexCount ?? 0,
          edgeOffset: constraintRange.edgeRange?.offset ?? 0,
          edgeCount: constraintRange.edgeRange?.count ?? 0,
          edgeCapacity: constraintRange.edgeRange?.count ?? 0,
          hingeOffset: constraintRange.hingeRange?.offset ?? 0,
          hingeCount: constraintRange.hingeRange?.count ?? 0,
          hingeCapacity: constraintRange.hingeRange?.count ?? 0,
        });
      });
    } else {
      resetSlotStates();
    }

    ensureBindGroups();
  }

  /**
   * @param {MeshView} [meshViews]
   * @param {ConstraintView} [constraintViews]
   * @param {ArtifactRecord[]} [artifactRecords]
   * @param {{ reset?: boolean }} [options]
   */
  function appendFromStaging(
    meshViews = {},
    constraintViews = {},
    artifactRecords = [],
    { reset = false } = {}
  ) {
    if (!streamingEnabled) {
      return uploadFromStaging(meshViews, constraintViews, artifactRecords);
    }
    if (reset) {
      resetGeometry();
    }
    if (!artifactRecords?.length) return 0;
    initializeStreamingBuffers();
    const config = requireStreamingConfig();
    const queue = device.queue;
    const {
      positions = new Float32Array(),
      masses = new Float32Array(),
      indices = new Uint32Array(),
    } = meshViews || {};
    const {
      edges = new Uint32Array(),
      edgeRestLengths = new Float32Array(),
      edgeCompliance = new Float32Array(),
      hinges = new Uint32Array(),
      hingeRestAngles = new Float32Array(),
      hingeCompliance = new Float32Array(),
    } = constraintViews || {};

    let appended = 0;
    for (const artifact of artifactRecords) {
      const meshRange = artifact?.ranges?.meshRange;
      if (!meshRange || !meshRange.vertexCount) continue;
      const addedVertices = meshRange.vertexCount;
      const addedIndices = meshRange.indexCount ?? 0;
      const constraintRange = artifact?.ranges?.constraintRange || {};
      const edgeRange = constraintRange.edgeRange || { offset: 0, count: 0 };
      const hingeRange = constraintRange.hingeRange || { offset: 0, count: 0 };
      const addedEdges = edgeRange.count ?? 0;
      const addedHinges = hingeRange.count ?? 0;

      if (
        vertexCount + addedVertices > config.maxVertices ||
        indexCount + addedIndices > config.maxIndices ||
        edgeCount + addedEdges > config.maxEdges ||
        hingeCount + addedHinges > config.maxHinges ||
        artifactCount + 1 > config.maxArtifacts
      ) {
        throw new Error('Simulation pool exhausted');
      }

      const gpuVertexOffset = vertexCount;
      const packedPositions = packPositionsSlice(positions, meshRange.vertexOffset ?? 0, addedVertices);
      queue.writeBuffer(restPositionBuffer, gpuVertexOffset * POSITION_STRIDE, packedPositions);
      queue.writeBuffer(positionBuffer, gpuVertexOffset * POSITION_STRIDE, packedPositions);

      const velocitySlice = buildInitialVelocitySlice(masses, meshRange.vertexOffset ?? 0, addedVertices);
      queue.writeBuffer(velocityBuffer, gpuVertexOffset * VELOCITY_STRIDE, velocitySlice);

      const artifactVertexIds = new Uint32Array(addedVertices);
      artifactVertexIds.fill(artifactCount);
      queue.writeBuffer(vertexArtifactBuffer, gpuVertexOffset * 4, artifactVertexIds);

      if (addedIndices > 0) {
        const rebasedIndices = rebaseIndexSlice(indices, meshRange.indexOffset ?? 0, addedIndices, gpuVertexOffset);
        queue.writeBuffer(indexBuffer, indexCount * 4, rebasedIndices);
      }

      if (addedEdges > 0) {
        const packedEdges = packEdgeSlice(edges, edgeRange.offset ?? 0, addedEdges, gpuVertexOffset);
        queue.writeBuffer(edgeBuffer, edgeCount * 16, packedEdges);
        const edgeRest = interleaveRestComplianceSlice(
          edgeRestLengths,
          edgeCompliance,
          edgeRange.offset ?? 0,
          addedEdges
        );
        queue.writeBuffer(edgeRestComplianceBuffer, edgeCount * 8, /** @type {BufferSource} */ (edgeRest));
      }

      if (addedHinges > 0) {
        const packedHinges = packHingeSlice(hinges, hingeRange.offset ?? 0, addedHinges, gpuVertexOffset);
        queue.writeBuffer(hingeBuffer, hingeCount * 16, packedHinges);
        const hingeRest = interleaveRestComplianceSlice(
          hingeRestAngles,
          hingeCompliance,
          hingeRange.offset ?? 0,
          addedHinges
        );
        queue.writeBuffer(hingeRestComplianceBuffer, hingeCount * 8, /** @type {BufferSource} */ (hingeRest));
      }

      const artifactState = encodeArtifactStateSingle(descriptorWithDefaults(artifact?.descriptor), addedVertices);
      queue.writeBuffer(artifactStateBuffer, artifactCount * ARTIFACT_STATE_SIZE, artifactState);

      vertexCount += addedVertices;
      indexCount += addedIndices;
      edgeCount += addedEdges;
      hingeCount += addedHinges;
      artifactCount += 1;
      appended += 1;
    }

    if (appended > 0) {
      artifactStateByteLength = artifactCount * ARTIFACT_STATE_SIZE;
      ensureArtifactReadback(artifactStateByteLength);
      artifactMetrics.total = artifactCount;
      artifactMetrics.active = artifactCount;
      artifactMetrics.settled = 0;
      artifactMetrics.avgImpulse = 0;
      artifactMetrics.avgContacts = 0;
      ensureBindGroups();
    }

    return appended;
  }

  function rewriteSlotsFromStaging(
    slotIndices = [],
    meshViews = {},
    constraintViews = {},
    artifactRecords = []
  ) {
    if (!streamingEnabled) {
      return { written: 0, failed: slotIndices?.slice?.() ?? [] };
    }
    if (!slotIndices?.length || !artifactRecords?.length) {
      return { written: 0, failed: [] };
    }
    const count = Math.min(slotIndices.length, artifactRecords.length);
    const positions = meshViews?.positions ?? new Float32Array();
    const indices = meshViews?.indices ?? new Uint32Array();
    const masses = meshViews?.masses ?? new Float32Array();
    const edges = constraintViews?.edges ?? new Uint32Array();
    const edgeRestLengths = constraintViews?.edgeRestLengths ?? new Float32Array();
    const edgeCompliance = constraintViews?.edgeCompliance ?? new Float32Array();
    const hinges = constraintViews?.hinges ?? new Uint32Array();
    const hingeRestAngles = constraintViews?.hingeRestAngles ?? new Float32Array();
    const hingeCompliance = constraintViews?.hingeCompliance ?? new Float32Array();
    const failed = [];
    let written = 0;

    for (let i = 0; i < count; i += 1) {
      const slotIndex = slotIndices[i];
      const slot = slotStates[slotIndex];
      const record = artifactRecords[i];
      const meshRange = record?.ranges?.meshRange;
      if (!slot || !meshRange) {
        failed.push(slotIndex);
        continue;
      }
      const constraintRange = record?.ranges?.constraintRange || {};
      const addedVertices = meshRange.vertexCount ?? 0;
      const addedIndices = meshRange.indexCount ?? 0;
      const edgeRange = constraintRange.edgeRange || { offset: 0, count: 0 };
      const hingeRange = constraintRange.hingeRange || { offset: 0, count: 0 };
      const addedEdges = edgeRange.count ?? 0;
      const addedHinges = hingeRange.count ?? 0;
      if (
        addedVertices <= 0 ||
        addedVertices > (slot.vertexCapacity || 0) ||
        addedIndices > (slot.indexCapacity || 0) ||
        addedEdges > (slot.edgeCapacity || 0) ||
        addedHinges > (slot.hingeCapacity || 0)
      ) {
        failed.push(slotIndex);
        continue;
      }

      const vertexOffset = meshRange.vertexOffset ?? 0;
      const positionSlice = packPositionsSlice(positions, vertexOffset, addedVertices);
      device.queue.writeBuffer(restPositionBuffer, slot.vertexOffset * POSITION_STRIDE, positionSlice);
      device.queue.writeBuffer(positionBuffer, slot.vertexOffset * POSITION_STRIDE, positionSlice);

      const velocitySlice = buildInitialVelocitySlice(masses, vertexOffset, addedVertices);
      device.queue.writeBuffer(velocityBuffer, slot.vertexOffset * VELOCITY_STRIDE, velocitySlice);

      const artifactVertexIds = new Uint32Array(Math.max(slot.vertexCapacity, addedVertices));
      artifactVertexIds.fill(slot.index);
      device.queue.writeBuffer(vertexArtifactBuffer, slot.vertexOffset * 4, artifactVertexIds);

      const rebasedIndices = rebaseIndexSlice(indices, meshRange.indexOffset ?? 0, addedIndices, slot.vertexOffset);
      if (addedIndices > 0) {
        device.queue.writeBuffer(indexBuffer, slot.indexOffset * 4, rebasedIndices);
      }
      const leftoverIndices = Math.max(0, (slot.indexCapacity || 0) - addedIndices);
      if (leftoverIndices > 0) {
        device.queue.writeBuffer(indexBuffer, (slot.indexOffset + addedIndices) * 4, getZeroBytes(leftoverIndices * 4));
      }

      if (slot.edgeCapacity > 0) {
        if (addedEdges > 0) {
          const packedEdges = packEdgeSlice(edges, edgeRange.offset ?? 0, addedEdges, slot.vertexOffset);
          device.queue.writeBuffer(edgeBuffer, slot.edgeOffset * 16, packedEdges);
          const edgeRest = interleaveRestComplianceSlice(
            edgeRestLengths,
            edgeCompliance,
            edgeRange.offset ?? 0,
            addedEdges
          );
          device.queue.writeBuffer(edgeRestComplianceBuffer, slot.edgeOffset * 8, /** @type {BufferSource} */ (edgeRest));
        }
        const leftoverEdges = Math.max(0, slot.edgeCapacity - addedEdges);
        if (leftoverEdges > 0) {
          device.queue.writeBuffer(edgeBuffer, (slot.edgeOffset + addedEdges) * 16, getZeroBytes(leftoverEdges * 16));
          device.queue.writeBuffer(
            edgeRestComplianceBuffer,
            (slot.edgeOffset + addedEdges) * 8,
            getZeroBytes(leftoverEdges * 8)
          );
        }
      } else if (addedEdges > 0) {
        failed.push(slotIndex);
        continue;
      }

      if (slot.hingeCapacity > 0) {
        if (addedHinges > 0) {
          const packedHinges = packHingeSlice(hinges, hingeRange.offset ?? 0, addedHinges, slot.vertexOffset);
          device.queue.writeBuffer(hingeBuffer, slot.hingeOffset * 16, packedHinges);
          const hingeRest = interleaveRestComplianceSlice(
            hingeRestAngles,
            hingeCompliance,
            hingeRange.offset ?? 0,
            addedHinges
          );
          device.queue.writeBuffer(hingeRestComplianceBuffer, slot.hingeOffset * 8, /** @type {BufferSource} */ (hingeRest));
        }
        const leftoverHinges = Math.max(0, slot.hingeCapacity - addedHinges);
        if (leftoverHinges > 0) {
          device.queue.writeBuffer(hingeBuffer, (slot.hingeOffset + addedHinges) * 16, getZeroBytes(leftoverHinges * 16));
          device.queue.writeBuffer(
            hingeRestComplianceBuffer,
            (slot.hingeOffset + addedHinges) * 8,
            getZeroBytes(leftoverHinges * 8)
          );
        }
      } else if (addedHinges > 0) {
        failed.push(slotIndex);
        continue;
      }

      const artifactState = encodeArtifactStateSingle(descriptorWithDefaults(record?.descriptor), addedVertices);
      device.queue.writeBuffer(artifactStateBuffer, slotIndex * ARTIFACT_STATE_SIZE, artifactState);

      slot.vertexCount = addedVertices;
      slot.indexCount = addedIndices;
      slot.edgeCount = addedEdges;
      slot.hingeCount = addedHinges;
      slot.settled = false;
      slot.sequence = slotSequenceCounter++;
      written += 1;
    }

    if (written > 0) {
      ensureBindGroups();
    }

    return { written, failed };
  }

  function ensureBindGroups() {
    if (!positionBuffer || !restPositionBuffer || !velocityBuffer || !vertexArtifactBuffer || !artifactStateBuffer) {
      integrationBindGroup = null;
      distanceConstraintBindGroup = null;
      hingeConstraintBindGroup = null;
      shapeConstraintBindGroup = null;
      restStateBindGroup = null;
      return;
    }
    integrationBindGroup = device.createBindGroup({
      label: 'stratified-integration-bind-group',
      layout: integrationLayout,
      entries: [
        { binding: 0, resource: { buffer: frameUniforms.buffer } },
        { binding: 1, resource: { buffer: simUniformBuffer } },
        { binding: 2, resource: { buffer: restPositionBuffer } },
        { binding: 3, resource: { buffer: positionBuffer } },
        { binding: 4, resource: { buffer: velocityBuffer } },
        { binding: 5, resource: { buffer: contactStateBuffer } },
        { binding: 6, resource: { buffer: contactDataBuffer } },
        { binding: 7, resource: { buffer: vertexArtifactBuffer } },
        { binding: 8, resource: { buffer: artifactStateBuffer } },
      ],
    });

    distanceConstraintBindGroup = device.createBindGroup({
      label: 'stratified-distance-constraint-bind-group',
      layout: distanceConstraintLayout,
      entries: [
        { binding: 0, resource: { buffer: frameUniforms.buffer } },
        { binding: 1, resource: { buffer: simUniformBuffer } },
        { binding: 2, resource: { buffer: positionBuffer } },
        { binding: 3, resource: { buffer: edgeBuffer } },
        { binding: 4, resource: { buffer: edgeRestComplianceBuffer } },
      ],
    });

    hingeConstraintBindGroup = device.createBindGroup({
      label: 'stratified-hinge-constraint-bind-group',
      layout: hingeConstraintLayout,
      entries: [
        { binding: 0, resource: { buffer: frameUniforms.buffer } },
        { binding: 1, resource: { buffer: simUniformBuffer } },
        { binding: 2, resource: { buffer: positionBuffer } },
        { binding: 3, resource: { buffer: hingeBuffer } },
        { binding: 4, resource: { buffer: hingeRestComplianceBuffer } },
      ],
    });

    shapeConstraintBindGroup = device.createBindGroup({
      label: 'stratified-shape-constraint-bind-group',
      layout: shapeMatchLayout,
      entries: [
        { binding: 0, resource: { buffer: frameUniforms.buffer } },
        { binding: 1, resource: { buffer: simUniformBuffer } },
        { binding: 2, resource: { buffer: positionBuffer } },
        { binding: 3, resource: { buffer: restPositionBuffer } },
      ],
    });

    restStateBindGroup = device.createBindGroup({
      label: 'stratified-rest-state-bind-group',
      layout: restStateLayout,
      entries: [
        { binding: 0, resource: { buffer: frameUniforms.buffer } },
        { binding: 1, resource: { buffer: simUniformBuffer } },
        { binding: 2, resource: { buffer: artifactStateBuffer } },
      ],
    });
  }

  function initializeStreamingBuffers() {
    if (!streamingEnabled || streamingBuffersReady) return;
    const config = requireStreamingConfig();
    const vertexBytes = config.maxVertices * POSITION_STRIDE;
    restPositionBuffer = device.createBuffer({
      label: 'stratified-rest-positions-stream',
      size: vertexBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    positionBuffer = device.createBuffer({
      label: 'stratified-positions-stream',
      size: vertexBytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    velocityBuffer = device.createBuffer({
      label: 'stratified-velocities-stream',
      size: config.maxVertices * VELOCITY_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    indexBuffer = device.createBuffer({
      label: 'stratified-indices-stream',
      size: config.maxIndices * 4,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    edgeBuffer = device.createBuffer({
      label: 'stratified-edges-stream',
      size: config.maxEdges * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    edgeRestComplianceBuffer = device.createBuffer({
      label: 'stratified-edge-rest-stream',
      size: config.maxEdges * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    hingeBuffer = device.createBuffer({
      label: 'stratified-hinges-stream',
      size: config.maxHinges * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    hingeRestComplianceBuffer = device.createBuffer({
      label: 'stratified-hinge-rest-stream',
      size: config.maxHinges * 8,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    vertexArtifactBuffer = device.createBuffer({
      label: 'stratified-vertex-artifacts-stream',
      size: config.maxVertices * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    artifactStateBuffer = device.createBuffer({
      label: 'stratified-artifact-state-stream',
      size: config.maxArtifacts * ARTIFACT_STATE_SIZE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    BUFFER_SIZES.set(restPositionBuffer, vertexBytes);
    BUFFER_SIZES.set(positionBuffer, vertexBytes);
    BUFFER_SIZES.set(velocityBuffer, config.maxVertices * VELOCITY_STRIDE);
    BUFFER_SIZES.set(indexBuffer, config.maxIndices * 4);
    BUFFER_SIZES.set(edgeBuffer, config.maxEdges * 16);
    BUFFER_SIZES.set(edgeRestComplianceBuffer, config.maxEdges * 8);
    BUFFER_SIZES.set(hingeBuffer, config.maxHinges * 16);
    BUFFER_SIZES.set(hingeRestComplianceBuffer, config.maxHinges * 8);
    BUFFER_SIZES.set(vertexArtifactBuffer, config.maxVertices * 4);
    BUFFER_SIZES.set(artifactStateBuffer, config.maxArtifacts * ARTIFACT_STATE_SIZE);
    streamingBuffersReady = true;
    ensureBindGroups();
  }

  function resetGeometry() {
    vertexCount = 0;
    indexCount = 0;
    edgeCount = 0;
    hingeCount = 0;
    artifactCount = 0;
    artifactStateByteLength = 0;
    artifactMetrics.total = 0;
    artifactMetrics.active = 0;
    artifactMetrics.settled = 0;
    artifactMetrics.avgImpulse = 0;
    artifactMetrics.avgContacts = 0;
    materialIdMap.clear();
    nextMaterialId = 0;
    device.queue.writeBuffer(contactStateBuffer, 0, contactStateInit);
    resetSlotStates();
  }

  function descriptorWithDefaults(descriptor = {}) {
    const material = descriptor.material || {};
    return {
      ...descriptor,
      material: {
        friction: 0.5,
        restitution: 0.08,
        damping: 0.9,
        smearCoeff: 0.5,
        id: 'default',
        ...material,
      },
    };
  }

  function encodeArtifactStateSingle(descriptor, vertexSpan) {
    const matKey = descriptor.material?.id ?? descriptor.classId ?? `mat-${nextMaterialId}`;
    if (!materialIdMap.has(matKey)) {
      materialIdMap.set(matKey, nextMaterialId);
      nextMaterialId += 1;
    }
    const matId = materialIdMap.get(matKey) ?? 0;
    const storage = new ArrayBuffer(ARTIFACT_STATE_SIZE);
    writeArtifactStateEntry(storage, 0, {
      materialId: matId,
      vertexCount: vertexSpan,
      material: descriptor.material,
    });
    return storage;
  }

  function step({
    time = 0,
    wobble = 0.005,
    gravity = [0, -981, 0],
    damping = 0.96,
    iterations = 1,
    groundHeight = -0.3,
    groundAmp = 0.12,
    groundFreq = 1.2,
    restThreshold = 0.015,
  } = {}) {
    device.queue.writeBuffer(contactStateBuffer, 0, contactCounterReset);
    if (!integrationBindGroup || vertexCount === 0) return;
    const simData = new Float32Array([
      vertexCount,
      wobble,
      time,
      damping,
      gravity[0] ?? 0,
      gravity[1] ?? -981,
      gravity[2] ?? 0,
      edgeCount,
      iterations,
      hingeCount,
      groundHeight,
      groundAmp,
      groundFreq,
      groundFreq,
      restThreshold,
      artifactCount,
    ]);
    device.queue.writeBuffer(simUniformBuffer, 0, simData.buffer, simData.byteOffset, simData.byteLength);

    const workgroupSize = 256;
    const encoder = device.createCommandEncoder({ label: 'stratified-sim-encoder' });
    let queryIndex = 0;
    const recordedPasses = [];
    let readbackRequest = null;
    let artifactReadbackRequested = false;

    const runPass = (label, enabled, execute) => {
      if (!enabled) {
        timings[label].cpu = 0;
        return;
      }
      let startSlot = -1;
      if (timestampQuerySet && queryIndex + 2 <= TIMESTAMP_SLOT_COUNT) {
        startSlot = queryIndex;
        /** @type {any} */ (encoder).writeTimestamp?.(timestampQuerySet, queryIndex++);
      }
      const cpuStart = now();
      execute();
      timings[label].cpu = now() - cpuStart;
      if (timestampQuerySet && startSlot >= 0) {
        /** @type {any} */ (encoder).writeTimestamp?.(timestampQuerySet, queryIndex++);
        recordedPasses.push({ label, start: startSlot, end: queryIndex - 1 });
      }
    };

    const integrateDispatch = Math.ceil(vertexCount / workgroupSize);
    runPass('integrate', integrateDispatch > 0, () => {
      const integratePass = encoder.beginComputePass({ label: 'stratified-integrate-pass' });
      integratePass.setPipeline(integrationPipeline);
      integratePass.setBindGroup(0, integrationBindGroup);
      integratePass.dispatchWorkgroups(integrateDispatch);
      integratePass.end();
    });

    if (edgeCount > 0 && distanceConstraintBindGroup) {
      runPass('distance', true, () => {
        const edgeDispatch = Math.ceil(edgeCount / workgroupSize);
        const distancePass = encoder.beginComputePass({ label: 'stratified-distance-pass' });
        distancePass.setPipeline(distanceConstraintPipeline);
        distancePass.setBindGroup(0, distanceConstraintBindGroup);
        distancePass.dispatchWorkgroups(edgeDispatch);
        distancePass.end();
      });
    } else {
      timings.distance.cpu = 0;
    }

    if (hingeCount > 0 && hingeConstraintBindGroup) {
      runPass('hinge', true, () => {
        const hingeDispatch = Math.ceil(hingeCount / workgroupSize);
        const hingePass = encoder.beginComputePass({ label: 'stratified-hinge-pass' });
        hingePass.setPipeline(hingeConstraintPipeline);
        hingePass.setBindGroup(0, hingeConstraintBindGroup);
        hingePass.dispatchWorkgroups(hingeDispatch);
        hingePass.end();
      });
    } else {
      timings.hinge.cpu = 0;
    }

    if (shapeClusterCount > 0 && shapeConstraintBindGroup) {
      runPass('shape', true, () => {
        const shapeDispatch = Math.ceil(shapeClusterCount / workgroupSize);
        const shapePass = encoder.beginComputePass({ label: 'stratified-shape-pass' });
        shapePass.setPipeline(shapeMatchPipeline);
        shapePass.setBindGroup(0, shapeConstraintBindGroup);
        shapePass.dispatchWorkgroups(shapeDispatch);
        shapePass.end();
      });
    } else {
      timings.shape.cpu = 0;
    }

    if (artifactCount > 0 && restStateBindGroup) {
      const restDispatch = Math.ceil(artifactCount / workgroupSize);
      runPass('rest', restDispatch > 0, () => {
        const restPass = encoder.beginComputePass({ label: 'stratified-rest-state-pass' });
        restPass.setPipeline(restStatePipeline);
        restPass.setBindGroup(0, restStateBindGroup);
        restPass.dispatchWorkgroups(restDispatch);
        restPass.end();
      });
    } else {
      timings.rest.cpu = 0;
    }

    if (timestampQuerySet && recordedPasses.length > 0 && queryIndex > 0) {
      const slot = acquireReadbackBuffer();
      if (slot) {
        readbackRequest = {
          slot,
          queryCount: Math.min(queryIndex, TIMESTAMP_SLOT_COUNT),
          passes: recordedPasses.map((entry) => ({ ...entry })),
        };
        const byteLength = readbackRequest.queryCount * 8;
        encoder.resolveQuerySet(timestampQuerySet, 0, readbackRequest.queryCount, slot.resolveBuffer, 0);
        encoder.copyBufferToBuffer(slot.resolveBuffer, 0, slot.readBuffer, 0, byteLength);
      }
    }

    if (artifactStateReadback && !artifactStateReadback.pending && artifactStateByteLength > 0) {
      encoder.copyBufferToBuffer(artifactStateBuffer, 0, artifactStateReadback.buffer, 0, artifactStateByteLength);
      artifactStateReadback.pending = true;
      artifactReadbackRequested = true;
    }

    device.queue.submit([encoder.finish()]);
    if (readbackRequest) {
      startTimestampReadback(readbackRequest);
    }
    if (artifactReadbackRequested) {
      startArtifactStateReadback();
    }
  }

  function getGeometryBuffers() {
    return {
      vertex: positionBuffer,
      index: indexBuffer,
      count: indexCount,
      vertexCount,
    };
  }

  function getBufferStats() {
    return {
      vertices: vertexCount,
      indices: indexCount,
      edges: edgeCount,
      hinges: hingeCount,
    };
  }

  function getContactBuffers() {
    return {
      state: contactStateBuffer,
      data: contactDataBuffer,
      capacity: CONTACT_CAPACITY,
      stride: CONTACT_RECORD_SIZE,
      artifacts: artifactStateBuffer,
      artifactCount,
    };
  }

  function getArtifactMetrics() {
    return { ...artifactMetrics };
  }

  function getTimings() {
    const snapshot = {};
    for (const label of PASS_LABELS) {
      snapshot[label] = { ...timings[label] };
    }
    return {
      mode: supportsTimestamps ? 'gpu' : 'cpu',
      passes: snapshot,
    };
  }

  function destroyBuffers() {
    positionBuffer?.destroy?.();
    velocityBuffer?.destroy?.();
    restPositionBuffer?.destroy?.();
    indexBuffer?.destroy?.();
    edgeBuffer?.destroy?.();
    edgeRestComplianceBuffer?.destroy?.();
    hingeBuffer?.destroy?.();
    hingeRestComplianceBuffer?.destroy?.();
    vertexArtifactBuffer?.destroy?.();
    artifactStateBuffer?.destroy?.();
    positionBuffer = null;
    velocityBuffer = null;
    restPositionBuffer = null;
    indexBuffer = null;
    edgeBuffer = null;
    edgeRestComplianceBuffer = null;
    hingeBuffer = null;
    hingeRestComplianceBuffer = null;
    vertexArtifactBuffer = null;
    artifactStateBuffer = null;
    integrationBindGroup = null;
    distanceConstraintBindGroup = null;
    hingeConstraintBindGroup = null;
    shapeConstraintBindGroup = null;
    restStateBindGroup = null;
    vertexCount = 0;
    indexCount = 0;
    edgeCount = 0;
    hingeCount = 0;
    artifactCount = 0;
    artifactStateByteLength = 0;
    artifactMetrics.total = 0;
    artifactMetrics.active = 0;
    artifactMetrics.settled = 0;
    artifactMetrics.avgImpulse = 0;
    artifactMetrics.avgContacts = 0;
    streamingBuffersReady = false;
    materialIdMap.clear();
    nextMaterialId = 0;
  }

  function recreateBuffer(buffer, size, usage, label) {
    const aligned = align(size, 16);
    if (buffer && (BUFFER_SIZES.get(buffer) ?? 0) >= aligned) {
      return buffer;
    }
    buffer?.destroy?.();
    const created = device.createBuffer({ label, size: Math.max(aligned, 16), usage });
    BUFFER_SIZES.set(created, Math.max(aligned, 16));
    return created;
  }

  function destroy() {
    destroyBuffers();
    simUniformBuffer.destroy();
    contactStateBuffer.destroy();
    contactDataBuffer.destroy();
    artifactStateReadback?.buffer.destroy?.();
    artifactStateReadback = null;
  }

  function dumpContacts(limit = 64) {
    if (!contactDataBuffer || !contactStateBuffer) {
      return Promise.resolve({ count: 0, capacity: CONTACT_CAPACITY, samples: [] });
    }
    const sampleCount = Math.max(1, Math.min(limit, CONTACT_CAPACITY));
    const byteLength = sampleCount * CONTACT_RECORD_SIZE;
    const stateBuffer = device.createBuffer({
      label: 'stratified-contact-dump-state',
      size: CONTACT_STATE_SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const dataBuffer = device.createBuffer({
      label: 'stratified-contact-dump-data',
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder({ label: 'stratified-contact-dump-encoder' });
    encoder.copyBufferToBuffer(contactStateBuffer, 0, stateBuffer, 0, CONTACT_STATE_SIZE);
    encoder.copyBufferToBuffer(contactDataBuffer, 0, dataBuffer, 0, byteLength);
    device.queue.submit([encoder.finish()]);

    return Promise.all([
      stateBuffer.mapAsync(MAP_MODE_READ, 0, CONTACT_STATE_SIZE),
      dataBuffer.mapAsync(MAP_MODE_READ, 0, byteLength),
    ])
      .then(() => {
        const stateCopy = stateBuffer.getMappedRange(0, CONTACT_STATE_SIZE).slice(0);
        const dataCopy = dataBuffer.getMappedRange(0, byteLength).slice(0);
        stateBuffer.unmap();
        dataBuffer.unmap();
        stateBuffer.destroy();
        dataBuffer.destroy();
        return parseContactDump(stateCopy, dataCopy, sampleCount);
      })
      .catch((error) => {
        try {
          stateBuffer.unmap();
        } catch {
          /* ignore */
        }
        try {
          dataBuffer.unmap();
        } catch {
          /* ignore */
        }
        stateBuffer.destroy();
        dataBuffer.destroy();
        throw error;
      });
  }

  function parseContactDump(stateCopy, dataCopy, limit) {
    const stateView = new Uint32Array(stateCopy);
    const recorded = Math.min(stateView[0] ?? 0, CONTACT_CAPACITY);
    const capacity = stateView[1] ?? CONTACT_CAPACITY;
    const floats = new Float32Array(dataCopy);
    const stride = CONTACT_RECORD_SIZE / 4;
    const available = Math.floor(floats.length / stride);
    const sampleCount = Math.min(recorded, limit, available);
    const samples = [];
    for (let i = 0; i < sampleCount; i += 1) {
      const base = i * stride;
      samples.push({
        position: { x: floats[base + 0], y: floats[base + 1], z: floats[base + 2] },
        artifactId: Math.max(0, Math.round(floats[base + 3])),
        normal: { x: floats[base + 4], y: floats[base + 5], z: floats[base + 6] },
        impulse: floats[base + 7],
        materialId: Math.max(0, Math.round(floats[base + 8])),
        vertexId: Math.max(0, Math.round(floats[base + 9])),
        smear: floats[base + 10],
      });
    }
    return { count: recorded, capacity, samples };
  }

  return {
    uploadFromStaging,
    appendFromStaging,
    rewriteSlots: rewriteSlotsFromStaging,
    getSettledSlots: getSettledSlotIndices,
    resetGeometry,
    step,
    getGeometryBuffers,
    getContactBuffers,
    getArtifactMetrics,
    getBufferStats,
    getTimings,
    dumpContacts,
    destroy,
  };
}

const zeroByteCache = new Map();

function getZeroBytes(byteLength) {
  if (!byteLength || byteLength <= 0) {
    return new Uint8Array();
  }
  if (!zeroByteCache.has(byteLength)) {
    zeroByteCache.set(byteLength, new Uint8Array(byteLength));
  }
  return zeroByteCache.get(byteLength);
}

function packPositions(source) {
  if (!source?.length) return new Float32Array();
  const vertexCount = Math.floor(source.length / 3);
  const packed = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i += 1) {
    const srcIdx = i * 3;
    const dstIdx = i * 4;
    packed[dstIdx] = source[srcIdx];
    packed[dstIdx + 1] = source[srcIdx + 1];
    packed[dstIdx + 2] = source[srcIdx + 2];
    packed[dstIdx + 3] = 1;
  }
  return packed;
}

function packPositionsSlice(source, startVertex, vertexCount) {
  if (!source?.length || vertexCount <= 0) return new Float32Array();
  const slice = source.subarray(startVertex * 3, (startVertex + vertexCount) * 3);
  return packPositions(slice);
}

function buildInitialVelocities(vertexCount, masses) {
  const data = new Float32Array(vertexCount * 4);
  const hasMass = masses && masses.length >= vertexCount;
  for (let i = 0; i < vertexCount; i += 1) {
    const mass = hasMass ? Math.max(masses[i], 1e-4) : 1;
    data[i * 4 + 3] = 1 / mass;
  }
  return data;
}

function buildInitialVelocitySlice(masses, startVertex, vertexCount) {
  if (vertexCount <= 0) return new Float32Array();
  const slice = masses?.subarray ? masses.subarray(startVertex, startVertex + vertexCount) : null;
  return buildInitialVelocities(vertexCount, slice);
}

function normalizeArtifacts(artifacts, vertexCount) {
  if (artifacts && artifacts.length > 0) {
    return artifacts;
  }
  if (vertexCount === 0) {
    return [];
  }
  return [
    {
      descriptor: {
        id: 'aggregate',
        material: {
          id: 'default',
          friction: 0.5,
          restitution: 0.12,
          damping: 0.85,
          smearCoeff: 0.6,
        },
      },
      ranges: { meshRange: { vertexOffset: 0, vertexCount } },
    },
  ];
}

function buildVertexArtifactIds(vertexCount, artifacts) {
  const data = new Uint32Array(vertexCount);
  if (!artifacts?.length || vertexCount === 0) {
    return data;
  }
  for (let id = 0; id < artifacts.length; id += 1) {
    const range = artifacts[id]?.ranges?.meshRange;
    if (!range) continue;
    const start = range.vertexOffset ?? 0;
    const count = range.vertexCount ?? 0;
    const end = Math.min(vertexCount, start + count);
    for (let v = start; v < end; v += 1) {
      data[v] = id;
    }
  }
  return data;
}

function createArtifactStateStorage(artifacts) {
  const storage = new ArrayBuffer(Math.max(artifacts.length, 1) * ARTIFACT_STATE_SIZE);
  const materialIds = new Map();
  let nextMaterialId = 0;
  for (let i = 0; i < artifacts.length; i += 1) {
    const material = artifacts[i]?.descriptor?.material || {};
    const span = artifacts[i]?.ranges?.meshRange?.vertexCount ?? 0;
    const key = material.id ?? `mat-${i}`;
    if (!materialIds.has(key)) {
      materialIds.set(key, nextMaterialId);
      nextMaterialId += 1;
    }
    const matId = materialIds.get(key) ?? 0;
    writeArtifactStateEntry(storage, i, {
      materialId: matId,
      vertexCount: span,
      material,
    });
  }
  return storage;
}

function packEdgeTriples(triples) {
  const count = Math.floor(triples.length / EDGE_TRIPLET_STRIDE);
  if (count === 0) return new Uint32Array();
  const packed = new Uint32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    packed[i * 4] = triples[i * 3];
    packed[i * 4 + 1] = triples[i * 3 + 1];
    packed[i * 4 + 2] = triples[i * 3 + 2];
    packed[i * 4 + 3] = 0;
  }
  return packed;
}

function align(value, multiple) {
  const remainder = value % multiple;
  return remainder === 0 ? value : value + multiple - remainder;
}

const INTEGRATION_WGSL = /* wgsl */ `
struct FrameUniforms {
  time : f32,
  deltaTime : f32,
  frameIndex : u32,
  pad0 : u32,
  gravity : vec3f,
  pad1 : f32,
};

struct SimUniforms {
  paramsA : vec4f,
  paramsB : vec4f,
  paramsC : vec4f,
  paramsD : vec4f,
};

struct ContactState {
  counter : atomic<u32>,
  capacity : u32,
  pad0 : u32,
  pad1 : u32,
};

struct ContactRecord {
  position : vec4f,
  normalImpulse : vec4f,
  payload : vec4f,
};

${ARTIFACT_STATE_STRUCT_WGSL}

const CONTACT_IMPULSE_SCALE : f32 = 2048.0;
const SPEED_TRACK_SCALE : f32 = 8192.0;

@group(0) @binding(0) var<uniform> frame : FrameUniforms;
@group(0) @binding(1) var<uniform> sim : SimUniforms;
@group(0) @binding(2) var<storage, read> restPositions : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> positions : array<vec4f>;
@group(0) @binding(4) var<storage, read_write> velocities : array<vec4f>;
@group(0) @binding(5) var<storage, read_write> contactState : ContactState;
@group(0) @binding(6) var<storage, read_write> contactRecords : array<ContactRecord>;
@group(0) @binding(7) var<storage, read> vertexArtifactIds : array<u32>;
@group(0) @binding(8) var<storage, read_write> artifactStates : array<ArtifactState>;

@compute @workgroup_size(256)
fn cs_integrate(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let count = u32(sim.paramsA.x + 0.5);
  if (idx >= count) {
    return;
  }
  let wobbleScale = sim.paramsA.y;
  let t = sim.paramsA.z;
  let damping = sim.paramsA.w;
  let gravity = sim.paramsB.xyz;
  let rest = restPositions[idx];
  var pos = positions[idx].xyz;
  var vel = velocities[idx].xyz;
  let invMass = velocities[idx].w;
  let artifactTotal = max(u32(sim.paramsD.w + 0.5), 1u);
  var artifactId = vertexArtifactIds[idx];
  artifactId = min(artifactId, artifactTotal - 1u);
  let artifactMaterial = artifactStates[artifactId].materialParams;
  vel += gravity * frame.deltaTime * 0.001;
  let phase = f32(idx) * 0.015 + t * 0.6;
  let offset = vec3f(0.0, sin(phase) * wobbleScale, cos(phase * 0.5) * wobbleScale * 0.4);
  pos = mix(rest.xyz + offset, pos + vel * frame.deltaTime * 0.001, 0.5);
  vel *= damping;

  let groundY = sampleHeightfield(pos.xz, sim, frame.time);
  if (pos.y < groundY) {
    let normal = vec3f(0.0, 1.0, 0.0);
    let contactPos = vec3f(pos.x, groundY, pos.z);
    var normalVel = dot(vel, normal);
    let impulse = max(-normalVel, 0.0);
    if (impulse > 0.0) {
      var tangential = vel - normal * normalVel;
      let tangentialLen = length(tangential);
      let friction = clamp(artifactMaterial.x, 0.0, 1.0);
      if (tangentialLen > 1e-4 && friction > 0.0) {
        let slip = clamp(friction * impulse, 0.0, tangentialLen);
        tangential -= normalize(tangential) * slip;
      }
      let tangentialDamp = clamp(artifactMaterial.z, 0.0, 0.95);
      tangential *= 1.0 - tangentialDamp * 0.5;
      let restitution = clamp(artifactMaterial.y, 0.0, 0.95);
      normalVel = -normalVel * restitution;
      vel = tangential + normal * max(normalVel, 0.0);
      accumulateArtifactImpulse(artifactId, impulse);
      pushContact(contactPos, normal, impulse, idx, artifactId, u32(artifactStates[artifactId].materialId));
    }
    pos.y = groundY;
  }

  let speedSq = dot(vel, vel);
  trackArtifactSpeed(artifactId, speedSq);
  positions[idx] = vec4f(pos, 1.0);
  velocities[idx] = vec4f(vel, invMass);
}

fn sampleHeightfield(posXZ : vec2f, simUniforms : SimUniforms, time : f32) -> f32 {
  let base = simUniforms.paramsC.z;
  let amp = simUniforms.paramsC.w;
  let freqX = max(simUniforms.paramsD.x, 0.01);
  let freqZ = max(simUniforms.paramsD.y, 0.01);
  let wave = sin(posXZ.x * freqX + time * 0.2) + cos(posXZ.y * freqZ);
  return base + amp * 0.5 * wave;
}

fn accumulateArtifactImpulse(artifactId : u32, impulse : f32) {
  if (impulse <= 0.0) {
    return;
  }
  let scaled = u32(clamp(impulse * CONTACT_IMPULSE_SCALE, 0.0, 4.0e9));
  atomicAdd(&artifactStates[artifactId].totalImpulse, scaled);
  atomicAdd(&artifactStates[artifactId].contactCount, 1u);
}

fn trackArtifactSpeed(artifactId : u32, speedSq : f32) {
  let scaled = u32(clamp(speedSq * SPEED_TRACK_SCALE, 0.0, 4.0e9));
  atomicMax(&artifactStates[artifactId].maxSpeed, scaled);
}

fn pushContact(position : vec3f, normal : vec3f, impulse : f32, vertexId : u32, artifactId : u32, materialId : u32) {
  let index = atomicAdd(&contactState.counter, 1u);
  if (index >= contactState.capacity) {
    return;
  }
  contactRecords[index].position = vec4f(position, f32(artifactId));
  contactRecords[index].normalImpulse = vec4f(normal, impulse);
  let smear = artifactStates[artifactId].materialParams.w;
  contactRecords[index].payload = vec4f(f32(materialId), f32(vertexId), smear, 0.0);
}
`;
const DISTANCE_CONSTRAINT_WGSL = /* wgsl */ `
struct FrameUniforms {
  time : f32,
  deltaTime : f32,
  frameIndex : u32,
  pad0 : u32,
  gravity : vec3f,
  pad1 : f32,
};

struct SimUniforms {
  paramsA : vec4f,
  paramsB : vec4f,
  paramsC : vec4f,
  paramsD : vec4f,
};

@group(0) @binding(0) var<uniform> frame : FrameUniforms;
@group(0) @binding(1) var<uniform> sim : SimUniforms;
@group(0) @binding(2) var<storage, read_write> positions : array<vec4f>;
@group(0) @binding(3) var<storage, read> edges : array<vec4u>;
@group(0) @binding(4) var<storage, read> edgeRestCompliance : array<vec2f>;

@compute @workgroup_size(256)
fn cs_distance(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let edgeCount = u32(sim.paramsB.w + 0.5);
  if (idx >= edgeCount || edgeCount == 0u) {
    return;
  }
  let edgeData = edges[idx];
  let i = edgeData.x;
  let j = edgeData.y;
  var pi = positions[i].xyz;
  var pj = positions[j].xyz;
  let restComp = edgeRestCompliance[idx];
  let restLength = restComp.x;
  let delta = pj - pi;
  let dist = max(length(delta), 1e-5);
  let diff = dist - restLength;
  if (abs(diff) < 1e-4) {
    return;
  }
  let compliance = restComp.y;
  let dt = max(frame.deltaTime, 1e-4);
  let w = 2.0 + (compliance / max(dt * dt, 1e-5));
  let correction = diff / (dist * w);
  let direction = delta / dist;
  pi += direction * correction;
  pj -= direction * correction;
  positions[i] = vec4f(pi, 1.0);
  positions[j] = vec4f(pj, 1.0);
}
`;

const HINGE_CONSTRAINT_WGSL = /* wgsl */ `
struct FrameUniforms {
  time : f32,
  deltaTime : f32,
  frameIndex : u32,
  pad0 : u32,
  gravity : vec3f,
  pad1 : f32,
};

struct SimUniforms {
  paramsA : vec4f,
  paramsB : vec4f,
  paramsC : vec4f,
  paramsD : vec4f,
};

@group(0) @binding(0) var<uniform> frame : FrameUniforms;
@group(0) @binding(1) var<uniform> sim : SimUniforms;
@group(0) @binding(2) var<storage, read_write> positions : array<vec4f>;
@group(0) @binding(3) var<storage, read> hinges : array<vec4u>;
@group(0) @binding(4) var<storage, read> hingeRestCompliance : array<vec2f>;

@compute @workgroup_size(256)
fn cs_hinge(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let hingeCount = u32(sim.paramsC.y + 0.5);
  if (idx >= hingeCount || hingeCount == 0u) {
    return;
  }
  enforceHinge(idx);
}

fn enforceHinge(index : u32) {
  let hinge = hinges[index];
  let i = hinge.x;
  let j = hinge.y;
  let k = hinge.z;
  let l = hinge.w;
  var pi = positions[i].xyz;
  var pj = positions[j].xyz;
  var pk = positions[k].xyz;
  var pl = positions[l].xyz;
  let edge = normalize(pj - pi);
  let n1 = normalizeSafe(cross(pk - pi, pk - pj));
  let n2 = normalizeSafe(cross(pl - pj, pl - pi));
  if (length(n1) < 1e-5 || length(n2) < 1e-5) {
    return;
  }
  let current = atan2(dot(edge, cross(n1, n2)), clamp(dot(n1, n2), -0.999, 0.999));
  let restComp = hingeRestCompliance[index];
  let restAngle = restComp.x;
  let diff = current - restAngle;
  if (abs(diff) < 1e-4) {
    return;
  }
  let compliance = restComp.y;
  let correction = clamp(diff, -0.5, 0.5) * (1.0 - clamp(compliance, 0.0, 1.0));
  pk -= n1 * correction;
  pl += n2 * correction;
  positions[k] = vec4f(pk, 1.0);
  positions[l] = vec4f(pl, 1.0);
}

fn normalizeSafe(v : vec3f) -> vec3f {
  let len = length(v);
  if (len < 1e-5) {
    return vec3f(0.0);
  }
  return v / len;
}
`;

const SHAPE_MATCH_WGSL = /* wgsl */ `
struct FrameUniforms {
  time : f32,
  deltaTime : f32,
  frameIndex : u32,
  pad0 : u32,
  gravity : vec3f,
  pad1 : f32,
};

struct SimUniforms {
  paramsA : vec4f,
  paramsB : vec4f,
  paramsC : vec4f,
  paramsD : vec4f,
};

@group(0) @binding(0) var<uniform> frame : FrameUniforms;
@group(0) @binding(1) var<uniform> sim : SimUniforms;
@group(0) @binding(2) var<storage, read_write> positions : array<vec4f>;
@group(0) @binding(3) var<storage, read> restPositions : array<vec4f>;

@compute @workgroup_size(256)
fn cs_shape_match(@builtin(global_invocation_id) gid : vec3<u32>) {
  // Placeholder for future cluster shape-matching; no-op for now.
  let _gidIndex = gid.x;
  if (_gidIndex == 0u) {
    return;
  }
}
`;

const REST_STATE_WGSL = /* wgsl */ `
struct FrameUniforms {
  time : f32,
  deltaTime : f32,
  frameIndex : u32,
  pad0 : u32,
  gravity : vec3f,
  pad1 : f32,
};

struct SimUniforms {
  paramsA : vec4f,
  paramsB : vec4f,
  paramsC : vec4f,
  paramsD : vec4f,
};

${ARTIFACT_STATE_STRUCT_WGSL}

const SPEED_TRACK_SCALE : f32 = 8192.0;

@group(0) @binding(0) var<uniform> frame : FrameUniforms;
@group(0) @binding(1) var<uniform> sim : SimUniforms;
@group(0) @binding(2) var<storage, read_write> artifactStates : array<ArtifactState>;

@compute @workgroup_size(256)
fn cs_rest_state(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let total = u32(sim.paramsD.w + 0.5);
  if (total == 0u || idx >= total) {
    return;
  }
  let threshold = max(sim.paramsD.z, 0.0);
  let speedQuant = atomicLoad(&artifactStates[idx].maxSpeed);
  let speed = f32(speedQuant) / SPEED_TRACK_SCALE;
  var restFrames = artifactStates[idx].restFrames;
  if (speed < threshold) {
    restFrames = min(restFrames + 1u, 1000u);
  } else {
    restFrames = 0u;
  }
  artifactStates[idx].restFrames = restFrames;
  var flags = artifactStates[idx].flags;
  if (restFrames > 90u && artifactStates[idx].vertexCount > 0u) {
    flags = flags | 0x1u;
  } else {
    flags = flags & ~0x1u;
  }
  artifactStates[idx].flags = flags;
  atomicStore(&artifactStates[idx].maxSpeed, 0u);
  atomicStore(&artifactStates[idx].totalImpulse, 0u);
  atomicStore(&artifactStates[idx].contactCount, 0u);
}
`;

/**
 * @param {Float32Array} rest
 * @param {Float32Array} [compliance]
 * @returns {Float32Array}
 */
function interleaveRestCompliance(rest, compliance = new Float32Array()) {
  const count = rest.length;
  const data = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    data[i * 2] = rest[i];
    data[i * 2 + 1] = compliance.length > i ? compliance[i] : 0.1;
  }
  return data;
}

/**
 * @param {Float32Array} rest
 * @param {Float32Array} [compliance]
 * @param {number} [offset]
 * @param {number} [count]
 * @returns {Float32Array}
 */
function interleaveRestComplianceSlice(rest, compliance = new Float32Array(), offset = 0, count = 0) {
  if (!count) return new Float32Array();
  const data = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    data[i * 2] = rest[offset + i] ?? 0;
    data[i * 2 + 1] = compliance[offset + i] ?? 0.1;
  }
  return data;
}

function rebaseIndexSlice(source, indexOffset, count, baseVertex) {
  if (!count) return new Uint32Array();
  const rebased = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) {
    rebased[i] = baseVertex + (source[indexOffset + i] ?? 0);
  }
  return rebased;
}

function packEdgeSlice(source, offset, count, baseVertex) {
  if (!count) return new Uint32Array();
  const data = new Uint32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const base = (offset + i) * EDGE_TRIPLET_STRIDE;
    data[i * 4] = baseVertex + (source[base] ?? 0);
    data[i * 4 + 1] = baseVertex + (source[base + 1] ?? 0);
    data[i * 4 + 2] = source[base + 2] ?? 0;
    data[i * 4 + 3] = 0;
  }
  return data;
}

function packHingeSlice(source, offset, count, baseVertex) {
  if (!count) return new Uint32Array();
  const data = new Uint32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const base = (offset + i) * HINGE_STRIDE;
    data[i * 4] = baseVertex + (source[base] ?? 0);
    data[i * 4 + 1] = baseVertex + (source[base + 1] ?? 0);
    data[i * 4 + 2] = baseVertex + (source[base + 2] ?? 0);
    data[i * 4 + 3] = baseVertex + (source[base + 3] ?? 0);
  }
  return data;
}

function normalizePoolConfig(config) {
  if (!config) return null;
  const {
    maxVertices,
    maxIndices,
    maxEdges,
    maxHinges,
    maxArtifacts,
  } = config;
  const values = [maxVertices, maxIndices, maxEdges, maxHinges, maxArtifacts];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    return null;
  }
  return {
    maxVertices: Math.floor(maxVertices),
    maxIndices: Math.floor(maxIndices),
    maxEdges: Math.floor(maxEdges),
    maxHinges: Math.floor(maxHinges),
    maxArtifacts: Math.floor(maxArtifacts),
  };
}
