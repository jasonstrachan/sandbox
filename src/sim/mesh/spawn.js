import { getSilhouette } from '../data/canonical-silhouettes.js';
import { JOINT_DEFINITIONS } from './joints.js';
import { vec2, add, rotate, bbox, centroid } from '../math/vec2.js';
import { Xoshiro128 } from '../rng/xoshiro128.js';

let artifactCounter = 0;

export function createSpawnArtifact(params, rngInstance) {
  const shape = getSilhouette(params.shapeId);
  if (!shape) {
    throw new Error(`Unknown canonical silhouette: ${params.shapeId}`);
  }

  const rng = rngInstance ?? new Xoshiro128(params.seed ?? 1);
  const scale = params.scale ?? 1;
  const rotation = params.rotation ?? 0;
  const position = params.position ?? vec2(0, 0);
  const jitter = params.jitter ?? 0;

  const dims = {
    width: shape.dimensions.width * scale,
    height: shape.dimensions.height * scale,
  };

  const transformPoint = (point) => {
    const local = vec2((point.x - 0.5) * dims.width, (point.y - 0.5) * dims.height);
    const rotated = rotate(local, rotation);
    return add(rotated, position);
  };

  const outline = shape.outline.map(transformPoint);

  const detail = clampDetail(params.meshDetail);
  const lattice = buildLattice(shape.id, shape.lattice, dims, rotation, position, jitter, rng, detail);
  const bounds = bbox(outline);
  const center = centroid(outline);

  return {
    id: params.id ?? `${shape.id}-${artifactCounter++}`,
    shapeId: shape.id,
    palette: shape.palette,
    dims,
    rotation,
    outline,
    centroid: center,
    bounds,
    particles: lattice.particles,
    topology: lattice.topology,
    diagnostics: lattice.diagnostics,
    spawn: { ...params },
  };
}

function buildLattice(shapeId, latticeDef, dims, rotation, position, jitter, rng, detail = 1) {
  const baseRows = Math.max(1, Math.floor(latticeDef.rows ?? 1));
  const baseCols = Math.max(1, Math.floor(latticeDef.cols ?? 1));
  const minRows = baseRows >= 2 ? 2 : 1;
  const minCols = baseCols >= 2 ? 2 : 1;
  const rows = Math.max(minRows, Math.round(baseRows * detail));
  const cols = Math.max(minCols, Math.round(baseCols * detail));
  const particles = [];
  const spacingX = cols > 1 ? dims.width / (cols - 1) : dims.width;
  const spacingY = rows > 1 ? dims.height / (rows - 1) : dims.height;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const local = vec2(
        cols > 1 ? col * spacingX - dims.width / 2 : 0,
        rows > 1 ? row * spacingY - dims.height / 2 : 0
      );
      const jittered = vec2(
        local.x + (jitter ? (rng.nextFloat() - 0.5) * jitter : 0),
        local.y + (jitter ? (rng.nextFloat() - 0.5) * jitter : 0)
      );
      const rotated = rotate(jittered, rotation);
      const world = add(rotated, position);
      const boundary = row === 0 || col === 0 || row === rows - 1 || col === cols - 1;
      particles.push({
        id: particles.length,
        row,
        col,
        local,
        position: world,
        prevPosition: { ...world },
        velocity: vec2(0, 0),
        invMass: 1,
        pinned: false,
        boundary,
      });
    }
  }

  const topology = buildLatticeTopology(rows, cols, particles);
  topology.joints = buildJointTopology(shapeId, rows, cols, particles);
  const diagnostics = { spacingX, spacingY, detail };
  return { particles, topology, diagnostics };
}

function buildLatticeTopology(rows, cols, particles) {
  const stretch = [];
  const shear = [];
  const areas = [];
  const bends = [];

  const idx = (row, col) => row * cols + col;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (col + 1 < cols) {
        stretch.push(makeEdge(idx(row, col), idx(row, col + 1), particles));
      }
      if (row + 1 < rows) {
        stretch.push(makeEdge(idx(row, col), idx(row + 1, col), particles));
      }
      if (row + 1 < rows && col + 1 < cols) {
        shear.push(makeEdge(idx(row, col), idx(row + 1, col + 1), particles));
        shear.push(makeEdge(idx(row, col + 1), idx(row + 1, col), particles));
      }
      if (row + 1 < rows && col + 1 < cols) {
        const i0 = idx(row, col);
        const i1 = idx(row, col + 1);
        const i2 = idx(row + 1, col);
        const i3 = idx(row + 1, col + 1);
        areas.push(makeTriangle(i0, i1, i3, particles));
        areas.push(makeTriangle(i0, i3, i2, particles));
      }
    }
  }

  // Horizontal bend triplets
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col + 2 < cols; col += 1) {
      bends.push(makeBend(idx(row, col), idx(row, col + 1), idx(row, col + 2), particles));
    }
  }

  // Vertical bend triplets
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row + 2 < rows; row += 1) {
      bends.push(makeBend(idx(row, col), idx(row + 1, col), idx(row + 2, col), particles));
    }
  }

  return { stretch, shear, areas, bends };
}

function makeEdge(i0, i1, particles) {
  const a = particles[i0].local;
  const b = particles[i1].local;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const restLength = Math.hypot(dx, dy);
  return { i0, i1, restLength, plasticStrain: 0 };
}

function makeTriangle(i0, i1, i2, particles) {
  const a = particles[i0].local;
  const b = particles[i1].local;
  const c = particles[i2].local;
  const area = 0.5 * Math.abs(a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  return { indices: [i0, i1, i2], restArea: area, plasticStrain: 0 };
}

function makeBend(iPrev, iMid, iNext, particles) {
  const prev = particles[iPrev].local;
  const mid = particles[iMid].local;
  const next = particles[iNext].local;
  return {
    iPrev,
    iMid,
    iNext,
    rest: {
      x: prev.x - 2 * mid.x + next.x,
      y: prev.y - 2 * mid.y + next.y,
    },
    plasticStrain: 0,
  };
}

function buildJointTopology(shapeId, rows, cols, particles) {
  const defs = JOINT_DEFINITIONS[shapeId] ?? [];
  if (!defs.length) return [];
  const joints = [];
  const idx = (row, col) => clampIndex(row, rows) * cols + clampIndex(col, cols);
  defs.forEach((def) => {
    const i0 = idx(def.a.row, def.a.col);
    const i1 = idx(def.b.row, def.b.col);
    const p0 = particles[i0].local;
    const p1 = particles[i1].local;
    const restLength = Math.hypot(p0.x - p1.x, p0.y - p1.y);
    joints.push({ i0, i1, restLength, breakStrain: def.breakStrain ?? 0.4, broken: false, plasticStrain: 0 });
  });
  return joints;
}

function clampIndex(value, max) {
  return Math.max(0, Math.min(max - 1, value));
}

function clampDetail(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.25, Math.min(2, value));
}
