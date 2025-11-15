const DEFAULT_CONTACT_OPTIONS = {
  cellSizes: [64, 32],
  epsilon: 1.5,
  includeInterior: false,
  includeProxies: true,
  proxySampleLimit: 160,
  cacheTtl: 120,
  maxPairsPerBucket: 96,
  jitter: 0.75,
  predictiveCcd: true,
  ccdScale: 1,
  ccdVelocityClamp: 2400,
  enableLayeredContacts: true,
  clusterRadiusScale: 1.5,
  radiusScale: 1.3,
};

const NEIGHBORS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, -1],
];

export function createContactState() {
  return {
    frameIndex: 0,
    cache: new Map(),
    activeContacts: [],
    stats: initContactStats(),
  };
}

export function resolveInterMeshContacts(artifacts, config = {}, state, context = {}) {
  if (!artifacts || artifacts.length < 2) return { collided: false, stats: initContactStats(), contacts: [] };
  const options = normalizeContactOptions(config);
  const contactState = state ?? createContactState();
  contactState.cacheTtl = options.cacheTtl;
  const frameIndex = context.frameIndex ?? contactState.frameIndex ?? 0;
  options.stepDt = Number.isFinite(context.stepDt) ? context.stepDt : 0;
  options.stepIndex = context.stepIndex ?? 0;
  options.iteration = context.iteration ?? 0;
  options.frameIndex = frameIndex;
  beginContactState(contactState, frameIndex);
  const pointClouds = buildPointClouds(artifacts, options);
  if (!pointClouds.some((cloud) => cloud.points.length)) {
    contactState.activeContacts = [];
    contactState.stats = initContactStats();
    return { collided: false, stats: contactState.stats, contacts: contactState.activeContacts };
  }
  const layers = buildSpatialLayers(pointClouds, options, contactState.stats);
  const { collided, stats } = sweepLayers(layers, pointClouds, artifacts, options, contactState, contactState.stats);
  augmentContactsWithLayers(contactState, artifacts, options);
  contactState.stats = stats;
  return { collided, stats, contacts: contactState.activeContacts, state: contactState };
}

function normalizeContactOptions(config) {
  const merged = { ...DEFAULT_CONTACT_OPTIONS, ...config };
  const baseCells = Array.isArray(merged.cellSizes) && merged.cellSizes.length ? merged.cellSizes : [merged.cellSize ?? 64];
  const unique = Array.from(new Set(baseCells.map((size) => Math.max(8, Math.round(size) || 8))));
  unique.sort((a, b) => b - a);
  if (!unique.length) unique.push(64);
  return {
    ...merged,
    cellSizes: unique,
    epsilon: Number.isFinite(merged.epsilon) ? merged.epsilon : DEFAULT_CONTACT_OPTIONS.epsilon,
    includeInterior: Boolean(merged.includeInterior),
    includeProxies: merged.includeProxies !== false,
    proxySampleLimit: Math.max(16, Math.floor(merged.proxySampleLimit ?? DEFAULT_CONTACT_OPTIONS.proxySampleLimit)),
    cacheTtl: Math.max(1, Math.floor(merged.cacheTtl ?? DEFAULT_CONTACT_OPTIONS.cacheTtl)),
    maxPairsPerBucket: Math.max(8, Math.floor(merged.maxPairsPerBucket ?? DEFAULT_CONTACT_OPTIONS.maxPairsPerBucket)),
    jitter: Number.isFinite(merged.jitter) ? merged.jitter : DEFAULT_CONTACT_OPTIONS.jitter,
    predictiveCcd: merged.predictiveCcd !== false,
    ccdScale: Number.isFinite(merged.ccdScale) ? merged.ccdScale : DEFAULT_CONTACT_OPTIONS.ccdScale,
    ccdVelocityClamp: Number.isFinite(merged.ccdVelocityClamp)
      ? Math.max(0, merged.ccdVelocityClamp)
      : DEFAULT_CONTACT_OPTIONS.ccdVelocityClamp,
    enableLayeredContacts: merged.enableLayeredContacts !== false,
    clusterRadiusScale: Number.isFinite(merged.clusterRadiusScale)
      ? Math.max(0.5, merged.clusterRadiusScale)
      : DEFAULT_CONTACT_OPTIONS.clusterRadiusScale,
    radiusScale: Number.isFinite(merged.radiusScale) ? Math.max(0.5, merged.radiusScale) : DEFAULT_CONTACT_OPTIONS.radiusScale,
  };
}

function beginContactState(state, frameIndex) {
  state.frameIndex = frameIndex;
  state.activeContacts = [];
  state.stats = initContactStats();
  pruneCache(state, state.cacheTtl ?? DEFAULT_CONTACT_OPTIONS.cacheTtl);
}

function initContactStats() {
  return {
    pairsTested: 0,
    contactsResolved: 0,
    cacheHits: 0,
    duplicates: 0,
    pinnedPairs: 0,
    maxPenetration: 0,
    layerContacts: 0,
    ccdSamples: 0,
  };
}

function pruneCache(state, ttl) {
  if (!state?.cache) return;
  const maxAge = Math.max(1, ttl ?? DEFAULT_CONTACT_OPTIONS.cacheTtl);
  const minFrame = (state.frameIndex ?? 0) - maxAge;
  state.cache.forEach((entry, key) => {
    if ((entry.lastFrame ?? -Infinity) < minFrame) {
      state.cache.delete(key);
    }
  });
}

function buildPointClouds(artifacts, options) {
  return artifacts.map((artifact, artifactIndex) => ({
    artifactIndex,
    points: collectContactPoints(artifact, options),
  }));
}

function collectContactPoints(artifact, options) {
  const points = [];
  if (!artifact?.particles?.length) return points;
  const particles = artifact.particles;
  const includeInterior = options.includeInterior;
  const defaultRadius = Math.max(artifact.contact?.baseRadius ?? 6, 2);
  const radiusScale = options.radiusScale ?? 1;
  const clusterMembership = artifact.contact?.clusterMembership;
  particles.forEach((particle, particleIndex) => {
    if (!includeInterior && !particle.boundary) return;
    const radius = (particle.radius ?? defaultRadius) * radiusScale;
    points.push({
      type: 'particle',
      particleIndex,
      radius,
      invMass: particle.invMass ?? 0,
      key: `p${particleIndex}`,
      cachedPosition: particle.position,
      velocity: particle.velocity ? { x: particle.velocity.x, y: particle.velocity.y } : { x: 0, y: 0 },
      clusterIndex: clusterMembership?.[particleIndex] ?? -1,
    });
  });
  if (!options.includeProxies) return points;
  const proxies = artifact.contact?.proxies ?? [];
  if (!proxies.length) return points;
  const stride = Math.max(1, Math.floor(proxies.length / options.proxySampleLimit));
  proxies.forEach((proxy, proxyIndex) => {
    if (proxyIndex % stride !== 0) return;
    const proxyState = sampleProxyState(proxy, particles, true);
    const cachedPosition = proxyState.position;
    const velocity = proxyState.velocity;
    const radius = (proxy.radius ?? defaultRadius) * radiusScale;
    points.push({
      type: 'proxy',
      proxyIndex,
      radius,
      invMass: proxy.invMass ?? 0,
      key: `x${proxyIndex}`,
      cachedPosition,
      velocity,
    });
  });
  return points;
}

function sampleProxyState(proxy, particles, includeVelocity = false) {
  if (!proxy?.indices?.length || !proxy.weights?.length) return { position: null, velocity: null };
  let px = 0;
  let py = 0;
  let vx = 0;
  let vy = 0;
  let total = 0;
  proxy.indices.forEach((particleIndex, idx) => {
    const weight = proxy.weights[idx] ?? 0;
    const particle = particles[particleIndex];
    if (!particle) return;
    px += particle.position.x * weight;
    py += particle.position.y * weight;
    if (includeVelocity) {
      vx += (particle.velocity?.x ?? 0) * weight;
      vy += (particle.velocity?.y ?? 0) * weight;
    }
    total += weight;
  });
  if (!total) return { position: null, velocity: null };
  const inv = 1 / total;
  const state = {
    position: { x: px * inv, y: py * inv },
  };
  if (includeVelocity) {
    state.velocity = { x: vx * inv, y: vy * inv };
  }
  return state;
}

function buildSpatialLayers(pointClouds, options, stats = initContactStats()) {
  return options.cellSizes.map((cellSize) => {
    const grid = new Map();
    pointClouds.forEach((cloud) => {
      cloud.points.forEach((point, pointIndex) => {
        const pos = samplePointForSpatialHash(point, options, stats);
        if (!pos) return;
        const cellX = Math.floor(pos.x / cellSize);
        const cellY = Math.floor(pos.y / cellSize);
        const key = cellKey(cellX, cellY);
        let bucket = grid.get(key);
        if (!bucket) {
          bucket = { cellX, cellY, items: [] };
          grid.set(key, bucket);
        }
        bucket.items.push({ artifactIndex: cloud.artifactIndex, pointIndex });
      });
    });
    return { cellSize, grid };
  });
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function samplePointForSpatialHash(point, options, stats) {
  const base = point.cachedPosition;
  if (!base) return null;
  if (!options.predictiveCcd) return base;
  const dt = options.stepDt ?? 0;
  if (!dt) return base;
  const velocity = point.velocity;
  if (!velocity) return base;
  const clamp = options.ccdVelocityClamp ?? 0;
  const scale = options.ccdScale ?? 1;
  const offsetX = clampScalar(velocity.x * dt * scale, clamp);
  const offsetY = clampScalar(velocity.y * dt * scale, clamp);
  if (Math.abs(offsetX) > 1e-3 || Math.abs(offsetY) > 1e-3) {
    stats.ccdSamples += 1;
    return { x: base.x + offsetX, y: base.y + offsetY };
  }
  return base;
}

function clampScalar(value, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return value;
  return Math.max(-limit, Math.min(limit, value));
}

function sweepLayers(layers, pointClouds, artifacts, options, state, stats = initContactStats()) {
  let collided = false;
  const visitedPairs = new Set();
  layers.forEach((layer, layerIndex) => {
    layer.grid.forEach((bucket) => {
      if (!bucket.items.length) return;
      if (processBucketPair(bucket, bucket, pointClouds, artifacts, options, state, visitedPairs, layerIndex, stats)) {
        collided = true;
      }
      NEIGHBORS.forEach(([dx, dy]) => {
        const neighborX = bucket.cellX + dx;
        const neighborY = bucket.cellY + dy;
        if (neighborX < bucket.cellX || (neighborX === bucket.cellX && neighborY <= bucket.cellY)) return;
        const neighbor = layer.grid.get(cellKey(neighborX, neighborY));
        if (!neighbor || !neighbor.items.length) return;
        if (processBucketPair(bucket, neighbor, pointClouds, artifacts, options, state, visitedPairs, layerIndex, stats)) {
          collided = true;
        }
      });
    });
  });
  state.activeContacts = state.activeContacts ?? [];
  return { collided, stats };
}

function processBucketPair(bucketA, bucketB, pointClouds, artifacts, options, state, visitedPairs, layerIndex, stats) {
  const same = bucketA === bucketB;
  const itemsA = bucketA.items;
  const itemsB = bucketB.items;
  let collided = false;
  for (let indexA = 0; indexA < itemsA.length; indexA += 1) {
    const entryA = itemsA[indexA];
    const start = same ? indexA + 1 : 0;
    let pairsTested = 0;
    for (let i = start; i < itemsB.length; i += 1) {
      const entryB = itemsB[i];
      if (entryA.artifactIndex === entryB.artifactIndex) continue;
      if (pairsTested++ > options.maxPairsPerBucket) break;
      if (handleCandidate(entryA, entryB, pointClouds, artifacts, options, state, visitedPairs, layerIndex, stats)) {
        collided = true;
      }
    }
  }
  return collided;
}

function handleCandidate(entryA, entryB, pointClouds, artifacts, options, state, visitedPairs, layerIndex, stats) {
  const artifactIndexA = entryA.artifactIndex;
  const artifactIndexB = entryB.artifactIndex;
  const pointA = getPoint(pointClouds, entryA);
  const pointB = getPoint(pointClouds, entryB);
  if (!pointA || !pointB) return false;
  const pairKey = makePairKey(artifactIndexA, pointA, artifactIndexB, pointB);
  if (visitedPairs.has(pairKey)) {
    stats.duplicates += 1;
    return false;
  }
  visitedPairs.add(pairKey);
  stats.pairsTested += 1;
  if (state.cache?.has(pairKey)) stats.cacheHits += 1;
  const artifactA = artifacts[artifactIndexA];
  const artifactB = artifacts[artifactIndexB];
  if (!artifactA || !artifactB) return false;
  const posA = getPointPosition(pointA, artifactA);
  const posB = getPointPosition(pointB, artifactB);
  if (!posA || !posB) return false;
  const radiusA = pointA.radius ?? 6;
  const radiusB = pointB.radius ?? 6;
  const epsilon = options.epsilon;
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  const distSq = dx * dx + dy * dy;
  const minDist = Math.max(0, radiusA + radiusB - epsilon);
  if (minDist <= 0) return false;
  if (distSq >= minDist * minDist) {
    updateCacheSeparation(state, pairKey, layerIndex, dx, dy, minDist);
    return false;
  }
  let dist = Math.sqrt(distSq);
  let nx;
  let ny;
  if (!Number.isFinite(dist) || dist === 0) {
    const jitter = unitFromSeed(pairKey, options.jitter);
    nx = jitter.x;
    ny = jitter.y;
    dist = 0;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }
  const penetration = minDist - dist;
  if (penetration <= 0) {
    updateCacheSeparation(state, pairKey, layerIndex, dx, dy, minDist);
    return false;
  }
  stats.contactsResolved += 1;
  stats.maxPenetration = Math.max(stats.maxPenetration, penetration);
  const pointRefA = encodePointReference(pointA);
  const pointRefB = encodePointReference(pointB);
  if (!pointRefA || !pointRefB) return false;
  const contactRecord = {
    key: pairKey,
    penetration,
    normal: { x: nx, y: ny },
    layerIndex,
    artifactIndexA,
    artifactIndexB,
    pointA: pointRefA,
    pointB: pointRefB,
    minDistance: minDist,
  };
  state.activeContacts.push(contactRecord);
  updateCacheEntry(state, pairKey, contactRecord);
  return true;
}

function getPoint(pointClouds, entry) {
  const cloud = pointClouds[entry.artifactIndex];
  if (!cloud) return null;
  return cloud.points[entry.pointIndex] ?? null;
}

function getPointPosition(point, artifact) {
  if (point.type === 'particle') return point.cachedPosition || null;
  if (point.type === 'proxy') {
    const proxy = artifact.contact?.proxies?.[point.proxyIndex];
    if (!proxy) return null;
    return sampleProxyState(proxy, artifact.particles).position;
  }
  return null;
}

function makePairKey(artifactIndexA, pointA, artifactIndexB, pointB) {
  if (artifactIndexA < artifactIndexB) {
    return `${artifactIndexA}:${pointA.key}|${artifactIndexB}:${pointB.key}`;
  }
  if (artifactIndexA > artifactIndexB) {
    return `${artifactIndexB}:${pointB.key}|${artifactIndexA}:${pointA.key}`;
  }
  return `${artifactIndexA}:${pointA.key}|${artifactIndexB}:${pointB.key}`;
}

function updateCacheEntry(state, key, contact) {
  if (!state.cache) state.cache = new Map();
  state.cache.set(key, {
    key,
    lastFrame: state.frameIndex,
    normal: contact.normal,
    penetration: contact.penetration,
    layerIndex: contact.layerIndex,
  });
}

function updateCacheSeparation(state, key, layerIndex, dx, dy, targetDist) {
  if (!state.cache || !state.cache.has(key)) return;
  const entry = state.cache.get(key);
  entry.lastFrame = state.frameIndex;
  entry.layerIndex = layerIndex;
  const dist = Math.hypot(dx, dy) || 1e-6;
  entry.normal = { x: dx / dist, y: dy / dist };
  entry.penetration = Math.max(0, targetDist - dist);
}

function unitFromSeed(seed, jitterMagnitude) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  const angle = (hash % 3600) * (Math.PI / 1800);
  const magnitude = Math.max(0.01, jitterMagnitude ?? 0.5);
  return { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude };
}

function encodePointReference(point) {
  if (!point) return null;
  if (point.type === 'particle') {
    return {
      type: 'particle',
      particleIndex: point.particleIndex,
      radius: point.radius,
    };
  }
  if (point.type === 'proxy') {
    return {
      type: 'proxy',
      proxyIndex: point.proxyIndex,
      radius: point.radius,
    };
  }
  return null;
}

function augmentContactsWithLayers(state, artifacts, options) {
  if (!options.enableLayeredContacts) return;
  const contacts = state.activeContacts ?? [];
  if (!contacts.length) return;
  const augmented = [];
  contacts.forEach((contact) => {
    augmented.push(contact);
    const layered = buildClusterContact(contact, artifacts, options);
    if (layered) {
      augmented.push(layered);
      if (state.stats) state.stats.layerContacts += 1;
    }
  });
  state.activeContacts = augmented;
}

function buildClusterContact(contact, artifacts, options) {
  const artifactA = artifacts[contact.artifactIndexA];
  const artifactB = artifacts[contact.artifactIndexB];
  if (!artifactA || !artifactB) return null;
  const pointA = resolveClusterDescriptor(artifactA, contact.pointA, options.clusterRadiusScale);
  const pointB = resolveClusterDescriptor(artifactB, contact.pointB, options.clusterRadiusScale);
  if (!pointA || !pointB) return null;
  return {
    ...contact,
    key: `${contact.key}|cluster`,
    pointA,
    pointB,
    layer: 'cluster',
  };
}

function resolveClusterDescriptor(artifact, descriptor, scale = 1.5) {
  if (!artifact?.contact?.clusters?.length) return null;
  if (descriptor?.type === 'cluster') return descriptor;
  const clusterIndex = resolveClusterIndex(artifact, descriptor);
  if (!Number.isInteger(clusterIndex) || clusterIndex < 0) return null;
  const cluster = artifact.contact.clusters[clusterIndex];
  if (!cluster) return null;
  const radius = (cluster.radius ?? descriptor?.radius ?? artifact.contact?.baseRadius ?? 6) * scale;
  return {
    type: 'cluster',
    clusterIndex,
    radius,
  };
}

function resolveClusterIndex(artifact, descriptor) {
  if (!artifact?.contact) return -1;
  if (descriptor?.type === 'cluster') return descriptor.clusterIndex ?? -1;
  if (descriptor?.type === 'particle') {
    return artifact.contact.clusterMembership?.[descriptor.particleIndex] ?? -1;
  }
  if (descriptor?.type === 'proxy') {
    const proxy = artifact.contact.proxies?.[descriptor.proxyIndex];
    const firstIndex = proxy?.indices?.[0];
    if (!Number.isInteger(firstIndex)) return -1;
    return artifact.contact.clusterMembership?.[firstIndex] ?? -1;
  }
  return -1;
}
