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
  const maskFn = createMaskPredicate(shape);

  const detail = clampDetail(params.meshDetail);
  const lattice = buildCustomLattice(shape, dims, rotation, position, jitter, rng, detail, maskFn);
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

function buildCustomLattice(shape, dims, rotation, position, jitter, rng, detail, maskFn) {
  if (shape?.builder === 'bicycleFrame' && Array.isArray(shape.tubes)) {
    return buildBicycleFrameLattice(shape, dims, rotation, position, jitter, rng, detail);
  }
  return buildLattice(shape.id, shape.lattice, dims, rotation, position, jitter, rng, detail, { mask: maskFn });
}

function buildLattice(shapeId, latticeDef, dims, rotation, position, jitter, rng, detail = 1, options = {}) {
  const { mask } = options;
  const baseRows = Math.max(1, Math.floor(latticeDef.rows ?? 1));
  const baseCols = Math.max(1, Math.floor(latticeDef.cols ?? 1));
  const minRows = baseRows >= 2 ? 2 : 1;
  const minCols = baseCols >= 2 ? 2 : 1;
  const rows = Math.max(minRows, Math.round(baseRows * detail));
  const cols = Math.max(minCols, Math.round(baseCols * detail));
  const particles = [];
  const indexMap = new Array(rows * cols).fill(-1);
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
      const normX = clamp01((local.x + dims.width / 2) / (dims.width || 1));
      const normY = clamp01((local.y + dims.height / 2) / (dims.height || 1));
      if (mask && !mask({ x: normX, y: normY })) {
        indexMap[row * cols + col] = -1;
        continue;
      }
      const id = particles.length;
      indexMap[row * cols + col] = id;
      particles.push({
        id,
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

  const topology = buildLatticeTopology(rows, cols, particles, indexMap);
  topology.joints = buildJointTopology(shapeId, rows, cols, particles, indexMap);
  const diagnostics = { spacingX, spacingY, detail, masked: typeof mask === 'function' };
  return { particles, topology, diagnostics };
}

function buildLatticeTopology(rows, cols, particles, indexMap) {
  const stretch = [];
  const shear = [];
  const areas = [];
  const bends = [];

  const gridIndex = (row, col) => indexMap[row * cols + col];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const self = gridIndex(row, col);
      if (self === undefined || self < 0) continue;
      if (col + 1 < cols) {
        const right = gridIndex(row, col + 1);
        if (right >= 0) stretch.push(makeEdge(self, right, particles));
      }
      if (row + 1 < rows) {
        const down = gridIndex(row + 1, col);
        if (down >= 0) stretch.push(makeEdge(self, down, particles));
      }
      if (row + 1 < rows && col + 1 < cols) {
        const diag = gridIndex(row + 1, col + 1);
        const right = gridIndex(row, col + 1);
        const down = gridIndex(row + 1, col);
        if (self >= 0 && diag >= 0) {
          if (diag >= 0 && right >= 0) shear.push(makeEdge(self, diag, particles));
          if (right >= 0 && down >= 0) shear.push(makeEdge(right, down, particles));
          if (right >= 0 && diag >= 0) areas.push(makeTriangle(self, right, diag, particles));
          if (down >= 0 && diag >= 0) areas.push(makeTriangle(self, diag, down, particles));
        }
      }
    }
  }

  // Horizontal bend triplets
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col + 2 < cols; col += 1) {
      const a = gridIndex(row, col);
      const b = gridIndex(row, col + 1);
      const c = gridIndex(row, col + 2);
      if (a >= 0 && b >= 0 && c >= 0) bends.push(makeBend(a, b, c, particles));
    }
  }

  // Vertical bend triplets
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row + 2 < rows; row += 1) {
      const a = gridIndex(row, col);
      const b = gridIndex(row + 1, col);
      const c = gridIndex(row + 2, col);
      if (a >= 0 && b >= 0 && c >= 0) bends.push(makeBend(a, b, c, particles));
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

function buildJointTopology(shapeId, rows, cols, particles, indexMap) {
  const defs = JOINT_DEFINITIONS[shapeId] ?? [];
  if (!defs.length) return [];
  const joints = [];
  const idx = (row, col) => {
    const clampedRow = clampIndex(row, rows);
    const clampedCol = clampIndex(col, cols);
    return indexMap[clampedRow * cols + clampedCol];
  };
  defs.forEach((def) => {
    const i0 = idx(def.a.row, def.a.col);
    const i1 = idx(def.b.row, def.b.col);
    if (i0 === undefined || i0 < 0 || i1 === undefined || i1 < 0) return;
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

function createMaskPredicate(shape) {
  if (!shape) return null;
  const polygon = shape.maskOutline?.map((point) => ({ x: point.x, y: point.y }));
  const segments = shape.maskSegments?.map((segment) => ({
    ax: segment.a[0],
    ay: segment.a[1],
    bx: segment.b[0],
    by: segment.b[1],
    radius: segment.radius ?? 0.03,
  }));
  if (!polygon && !segments) return null;
  return ({ x, y }) => {
    if (segments?.some((segment) => distanceToSegment(x, y, segment) <= segment.radius)) return true;
    if (polygon && pointInPolygon(x, y, polygon)) return true;
    return false;
  };
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-5) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function distanceToSegment(px, py, segment) {
  const { ax, ay, bx, by } = segment;
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy || 1e-6;
  const t = clamp01((wx * vx + wy * vy) / lenSq);
  const projX = ax + t * vx;
  const projY = ay + t * vy;
  const dx = px - projX;
  const dy = py - projY;
  return Math.hypot(dx, dy);
}

function buildBicycleFrameLattice(shape, dims, rotation, position, jitter, rng, detail = 1) {
  const particles = [];
  const particleMap = new Map();
  const topology = { stretch: [], shear: [], areas: [], bends: [] };
  const strips = [];
  const baseScale = Math.min(dims.width, dims.height);

  const addParticle = (local) => {
    const key = `${Math.round(local.x * 10) / 10}:${Math.round(local.y * 10) / 10}`;
    if (particleMap.has(key)) return particleMap.get(key);
    const jittered = {
      x: local.x + (jitter ? (rng.nextFloat() - 0.5) * jitter : 0),
      y: local.y + (jitter ? (rng.nextFloat() - 0.5) * jitter : 0),
    };
    const rotated = rotate(jittered, rotation);
    const world = add(rotated, position);
    const particle = {
      id: particles.length,
      row: 0,
      col: 0,
      local,
      position: world,
      prevPosition: { ...world },
      velocity: vec2(0, 0),
      invMass: 1,
      pinned: false,
      boundary: true,
    };
    const index = particles.length;
    particleMap.set(key, index);
    particles.push(particle);
    return index;
  };

  const pushStretch = (i0, i1) => {
    if (i0 === i1 || i0 < 0 || i1 < 0) return;
    const a = particles[i0].local;
    const b = particles[i1].local;
    const rest = Math.hypot(a.x - b.x, a.y - b.y);
    if (rest === 0) return;
    topology.stretch.push({ i0, i1, restLength: rest, plasticStrain: 0 });
  };

  const pushShear = (i0, i1) => {
    if (i0 === i1 || i0 < 0 || i1 < 0) return;
    const a = particles[i0].local;
    const b = particles[i1].local;
    const rest = Math.hypot(a.x - b.x, a.y - b.y);
    if (rest === 0) return;
    topology.shear.push({ i0, i1, restLength: rest, plasticStrain: 0 });
  };

  const pushArea = (i0, i1, i2) => {
    if (i0 < 0 || i1 < 0 || i2 < 0) return;
    const a = particles[i0].local;
    const b = particles[i1].local;
    const c = particles[i2].local;
    const area = 0.5 * Math.abs(a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (area === 0) return;
    topology.areas.push({ indices: [i0, i1, i2], restArea: area, plasticStrain: 0 });
  };

  const buildStrip = (tube) => {
    const points = tube.path ?? [];
    if (points.length < 2) return [];
    const strip = [];
    for (let idx = 0; idx < points.length - 1; idx += 1) {
      const start = points[idx];
      const end = points[idx + 1];
      const localStart = {
        x: (start[0] - 0.5) * dims.width,
        y: (start[1] - 0.5) * dims.height,
      };
      const localEnd = {
        x: (end[0] - 0.5) * dims.width,
        y: (end[1] - 0.5) * dims.height,
      };
      const diff = { x: localEnd.x - localStart.x, y: localEnd.y - localStart.y };
      const length = Math.hypot(diff.x, diff.y) || 1;
      const dir = { x: diff.x / length, y: diff.y / length };
      const spacing = Math.max(6, (tube.radius ?? 0.02) * baseScale * 0.8 / detail);
      const steps = Math.max(1, Math.ceil(length / spacing));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const center = {
          x: localStart.x + diff.x * t,
          y: localStart.y + diff.y * t,
        };
        const normal = { x: -dir.y, y: dir.x };
        const width = (tube.radius ?? 0.02) * baseScale;
        const leftLocal = {
          x: center.x + normal.x * width,
          y: center.y + normal.y * width,
        };
        const rightLocal = {
          x: center.x - normal.x * width,
          y: center.y - normal.y * width,
        };
        const leftIndex = addParticle(leftLocal);
        const rightIndex = addParticle(rightLocal);
        strip.push({ left: leftIndex, right: rightIndex });
      }
    }
    return strip;
  };

  shape.tubes.forEach((tube) => {
    const strip = buildStrip(tube);
    if (strip.length) strips.push(strip);
  });

  strips.forEach((strip) => {
    strip.forEach((sample, index) => {
      pushStretch(sample.left, sample.right);
      if (index + 1 < strip.length) {
        const next = strip[index + 1];
        pushStretch(sample.left, next.left);
        pushStretch(sample.right, next.right);
        pushShear(sample.left, next.right);
        pushShear(sample.right, next.left);
        pushArea(sample.left, sample.right, next.right);
        pushArea(sample.left, next.right, next.left);
      }
    });
  });

  const diagnostics = { spacingX: 0, spacingY: 0, detail, strips: strips.length, custom: 'bicycle-frame' };
  return { particles, topology, diagnostics };
}
