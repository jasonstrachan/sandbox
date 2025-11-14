function cellKey(x, y) {
  return `${x},${y}`;
}

export function resolveInterMeshContacts(artifacts, config = {}) {
  if (!artifacts || artifacts.length < 2) return false;
  const cellSize = config.cellSize ?? 64;
  const epsilon = config.epsilon ?? 0.5;
  const iterations = config.iterations ?? 1;
  let collided = false;
  for (let iter = 0; iter < iterations; iter += 1) {
    const grid = buildSpatialHash(artifacts, cellSize);
    if (sweepGrid(grid, artifacts, epsilon)) collided = true;
  }
  return collided;
}

function buildSpatialHash(artifacts, cellSize) {
  const grid = new Map();
  artifacts.forEach((artifact, artifactIndex) => {
    artifact.particles.forEach((particle, particleIndex) => {
      const cellX = Math.floor(particle.position.x / cellSize);
      const cellY = Math.floor(particle.position.y / cellSize);
      const key = cellKey(cellX, cellY);
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = { cellX, cellY, items: [] };
        grid.set(key, bucket);
      }
      bucket.items.push({ artifactIndex, particleIndex });
    });
  });
  return grid;
}

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

function sweepGrid(grid, artifacts, epsilon) {
  let collided = false;
  grid.forEach((bucket, key) => {
    if (!bucket.items.length) return;
    if (processPairBucket(bucket, bucket, artifacts, epsilon)) collided = true;
    NEIGHBORS.forEach(([dx, dy]) => {
      const neighborX = bucket.cellX + dx;
      const neighborY = bucket.cellY + dy;
      if (neighborX < bucket.cellX || (neighborX === bucket.cellX && neighborY <= bucket.cellY)) return;
      const neighbor = grid.get(cellKey(neighborX, neighborY));
      if (!neighbor) return;
      if (processPairBucket(bucket, neighbor, artifacts, epsilon)) collided = true;
    });
  });
  return collided;
}

function processPairBucket(a, b, artifacts, epsilon) {
  let collided = false;
  const itemsA = a.items;
  const itemsB = b.items;
  itemsA.forEach((entryA, indexA) => {
    const start = a === b ? indexA + 1 : 0;
    for (let i = start; i < itemsB.length; i += 1) {
      const entryB = itemsB[i];
      if (entryA.artifactIndex === entryB.artifactIndex) continue;
      if (resolvePair(entryA, entryB, artifacts, epsilon)) collided = true;
    }
  });
  return collided;
}

function resolvePair(entryA, entryB, artifacts, epsilon) {
  const artifactA = artifacts[entryA.artifactIndex];
  const artifactB = artifacts[entryB.artifactIndex];
  if (!artifactA || !artifactB) return false;
  const particleA = artifactA.particles[entryA.particleIndex];
  const particleB = artifactB.particles[entryB.particleIndex];
  if (!particleA || !particleB) return false;
  const dx = particleB.position.x - particleA.position.x;
  const dy = particleB.position.y - particleA.position.y;
  const distSq = dx * dx + dy * dy;
  const radiusA = particleA.radius ?? 6;
  const radiusB = particleB.radius ?? 6;
  const minDist = radiusA + radiusB - epsilon;
  if (minDist <= 0) return false;
  if (distSq === 0) {
    jitterParticles(particleA, particleB, minDist * 0.5);
    return true;
  }
  if (distSq >= minDist * minDist) return false;
  const dist = Math.sqrt(distSq) || 1e-6;
  const penetration = minDist - dist;
  if (penetration <= 0) return false;
  const nx = dx / dist;
  const ny = dy / dist;
  const wA = particleA.invMass;
  const wB = particleB.invMass;
  const wSum = wA + wB;
  if (wSum === 0) return false;
  const correction = penetration / wSum;
  if (!particleA.pinned) {
    particleA.position.x -= nx * correction * wA;
    particleA.position.y -= ny * correction * wA;
  }
  if (!particleB.pinned) {
    particleB.position.x += nx * correction * wB;
    particleB.position.y += ny * correction * wB;
  }
  return true;
}

function jitterParticles(a, b, amount) {
  if (a.pinned && b.pinned) return;
  const half = amount * 0.5;
  if (!a.pinned) {
    a.position.x -= half;
    a.position.y -= half;
  }
  if (!b.pinned) {
    b.position.x += half;
    b.position.y += half;
  }
}
