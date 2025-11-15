import { vec2 } from '../math/vec2.js';
import { createSpawnArtifact } from '../mesh/spawn.js';
import { getMaterialProfile } from '../core/materials.js';
import { Xoshiro128 } from '../rng/xoshiro128.js';

const MAX_CONTACT_PROXIES = 256;
const TARGET_CLUSTER_DIVISIONS = 6;

export function instantiateArtifact(spawnParams, options = {}) {
  const rng = options.rng ?? new Xoshiro128(spawnParams.seed ?? 'artifact');
  const spawn = options.spawn ?? createSpawnArtifact(spawnParams, rng);
  const material = cloneMaterial(options.material ?? getMaterialProfile(spawn.shapeId));

  const particleCount = spawn.particles.length || 1;
  const areaEstimate = Math.max(spawn.dims.width * spawn.dims.height, 1);
  const totalMass = areaEstimate * material.density;
  const massPerParticle = totalMass / particleCount;
  const invMass = massPerParticle > 0 ? 1 / massPerParticle : 0;
  const spacingX = spawn.diagnostics?.spacingX ?? 16;
  const spacingY = spawn.diagnostics?.spacingY ?? 16;
  const particleRadius = Math.max(Math.min(spacingX, spacingY) * 0.35, 3);

  const particles = spawn.particles.map((particle) => {
    const position = { ...particle.position };
    return {
      id: particle.id,
      row: particle.row,
      col: particle.col,
      local: { ...particle.local },
      position,
      prevPosition: { ...position },
      velocity: vec2(0, 0),
      invMass,
      mass: massPerParticle,
      pinned: particle.pinned || false,
      boundary: particle.boundary || false,
      radius: particle.radius ?? particleRadius,
    };
  });

  const contact = buildContactMetadata(spawn, particles, { spacingX, spacingY });

  const stretchCount = spawn.topology.stretch.length + spawn.topology.shear.length;
  const areaCount = spawn.topology.areas.length;
  const bendCount = spawn.topology.bends.length;

  return {
    id: spawn.id,
    shapeId: spawn.shapeId,
    spawn,
    particles,
    topology: spawn.topology,
    material,
    state: 'active',
    age: 0,
    tier: 'active',
    opacity: 1,
    nextUpdateFrame: 0,
    plasticStrain: 0,
    debug: {
      stretchResiduals: new Float32Array(stretchCount),
      areaResiduals: new Float32Array(areaCount),
      bendResiduals: new Float32Array(bendCount),
    },
    contact,
  };
}

function cloneMaterial(profile) {
  return {
    ...profile,
    compliance: { ...profile.compliance },
    friction: { ...profile.friction },
    plastic: { ...profile.plastic },
    damping: { ...profile.damping },
  };
}

function buildContactMetadata(spawn, particles, diagnostics = {}) {
  const proxies = buildProxySet(spawn?.topology?.areas ?? [], particles, diagnostics);
  const clusterData = buildClusterSet(particles, diagnostics);
  const spacingX = Number.isFinite(diagnostics.spacingX) ? diagnostics.spacingX : 16;
  const spacingY = Number.isFinite(diagnostics.spacingY) ? diagnostics.spacingY : 16;
  const baseRadius = Math.max(Math.min(spacingX, spacingY) * 0.35, 4);
  return {
    proxies,
    clusters: clusterData.clusters,
    clusterMembership: clusterData.membership,
    baseRadius,
  };
}

function buildProxySet(triangles, particles, diagnostics) {
  if (!Array.isArray(triangles) || !triangles.length) return [];
  const proxies = [];
  const stride = Math.max(1, Math.floor(triangles.length / MAX_CONTACT_PROXIES));
  triangles.forEach((triangle, index) => {
    if (index % stride !== 0) return;
    const indices = triangle?.indices?.filter((idx) => Number.isInteger(idx) && idx >= 0) ?? [];
    if (indices.length < 3) return;
    const weight = 1 / indices.length;
    const weights = new Array(indices.length).fill(weight);
    let invMass = 0;
    indices.forEach((particleIndex) => {
      const particle = particles[particleIndex];
      if (!particle) return;
      const value = particle.invMass ?? 0;
      invMass += weight * weight * value;
    });
    proxies.push({
      indices,
      weights,
      radius: proxyRadiusFromArea(triangle?.restArea, diagnostics),
      invMass,
    });
  });
  return proxies;
}

function proxyRadiusFromArea(area, diagnostics) {
  const spacingX = Number.isFinite(diagnostics.spacingX) ? diagnostics.spacingX : 16;
  const spacingY = Number.isFinite(diagnostics.spacingY) ? diagnostics.spacingY : 16;
  const base = Math.max(Math.min(spacingX, spacingY) * 0.4, 4);
  if (!Number.isFinite(area) || area <= 0) return base;
  const equivalent = Math.max(Math.sqrt(Math.abs(area) / Math.PI), 2);
  return clampRange(equivalent, base * 0.5, base * 3);
}

function buildClusterSet(particles, diagnostics = {}) {
  if (!particles?.length) return { clusters: [], membership: [] };
  const membership = new Array(particles.length).fill(-1);
  const maxRow = particles.reduce((acc, particle) => Math.max(acc, particle.row ?? 0), 0) + 1;
  const maxCol = particles.reduce((acc, particle) => Math.max(acc, particle.col ?? 0), 0) + 1;
  const rowStride = Math.max(1, Math.round(maxRow / TARGET_CLUSTER_DIVISIONS));
  const colStride = Math.max(1, Math.round(maxCol / TARGET_CLUSTER_DIVISIONS));
  const clusterMap = new Map();
  particles.forEach((particle, index) => {
    const rowKey = Math.floor((particle.row ?? 0) / rowStride);
    const colKey = Math.floor((particle.col ?? 0) / colStride);
    const key = `${rowKey}:${colKey}`;
    let cluster = clusterMap.get(key);
    if (!cluster) {
      cluster = { indices: [], weights: [], id: clusterMap.size };
      clusterMap.set(key, cluster);
    }
    cluster.indices.push(index);
    cluster.weights.push(1);
    membership[index] = cluster.id;
  });
  const clusters = [];
  const baseRadius = clusterRadiusFromSpacing(diagnostics);
  clusterMap.forEach((cluster) => {
    const count = cluster.indices.length || 1;
    const weight = 1 / count;
    cluster.weights = cluster.weights.map(() => weight);
    let invMass = 0;
    cluster.indices.forEach((particleIndex) => {
      const particle = particles[particleIndex];
      if (!particle) return;
      invMass += weight * weight * (particle.invMass ?? 0);
    });
    clusters[cluster.id] = {
      indices: cluster.indices,
      weights: cluster.weights,
      radius: baseRadius,
      invMass,
    };
  });
  return { clusters, membership };
}

function clusterRadiusFromSpacing(diagnostics) {
  const spacingX = Number.isFinite(diagnostics.spacingX) ? diagnostics.spacingX : 16;
  const spacingY = Number.isFinite(diagnostics.spacingY) ? diagnostics.spacingY : 16;
  const base = Math.max(Math.min(spacingX, spacingY), 8);
  return base * 0.8;
}

function clampRange(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
