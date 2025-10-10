import { Perlin } from '../utils/noise.js';
import { poissonInPolygon } from '../utils/seeding.js';

export function runNet({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const spacing = Math.max(6, readNumber(controls.netSpacing, 26));
  const warp = Math.max(0, readNumber(controls.netWarp, 0.65));
  const noiseScale = Math.max(0.0001, readNumber(controls.netNoiseScale, 0.004));
  const strokeWidth = Math.max(0.25, readNumber(controls.netLineWidth, 1.25));
  const seed = readNumber(controls.netSeed, 2323) | 0;
  const alpha = controls.netAlpha ? clampAlpha(readNumber(controls.netAlpha, 0.9)) : 0.9;
  const color = controls.color?.value || '#000000';

  const poissonRng = createRng(seed ^ 0x9e3779b9);
  const samples = poissonInPolygon(Math.max(4, spacing * 0.92), state.pts, canvas.width, canvas.height, poissonRng);
  if (samples.length < 2) return;

  const perlin = new Perlin(seed);
  const jittered = jitterPoints(samples, perlin, noiseScale, spacing, warp, seed);

  const edgeRng = createRng(seed ^ 0x51633e2d);
  const edges = buildEdges(samples, spacing, edgeRng);
  if (!edges.length) return;

  const widthRng = createRng(seed ^ 0x27d4eb2d);
  const alphaRng = createRng(seed ^ 0x4c957f2b);

  const radialAmplitude = computeRadialAmplitude(spacing, warp);
  const tangentAmplitude = computeTangentAmplitude(spacing, warp);
  const stepSize = Math.max(8, spacing * 0.55);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const edge of edges) {
    const a = jittered[edge.a];
    const b = jittered[edge.b];
    if (!a || !b) continue;

    const widthScale = 0.92 + (widthRng() - 0.5) * 0.22;
    const alphaScale = 0.85 + (alphaRng() - 0.5) * 0.24;

    ctx.lineWidth = Math.max(0.1, strokeWidth * widthScale);
    ctx.globalAlpha = clampAlpha(alpha * alphaScale);

    drawOrganicEdge(ctx, a, b, {
      perlin,
      noiseScale,
      radialAmplitude,
      tangentAmplitude,
      stepSize,
      seed,
      edgeId: hashEdge(edge.a, edge.b, seed),
    });
  }

  ctx.restore();
}

function drawOrganicEdge(ctx, start, end, options) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-3) return;

  const steps = Math.max(4, Math.ceil(length / options.stepSize));
  const nx = -dy / length;
  const ny = dx / length;
  const tx = dx / length;
  const ty = dy / length;

  const phaseX = (options.edgeId * 0.000513 + options.seed * 0.031) % 1000;
  const phaseY = (options.edgeId * 0.000417 + options.seed * 0.047) % 1000;
  const noiseScale = options.noiseScale;

  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const baseX = start.x + dx * t;
    const baseY = start.y + dy * t;
    const eased = Math.sin(Math.PI * t);

    const radialNoise = options.perlin.fbm2((baseX + phaseX) * noiseScale, (baseY + phaseY) * noiseScale, 4);
    const radialOffset = radialNoise * options.radialAmplitude * eased;

    let px = baseX + nx * radialOffset;
    let py = baseY + ny * radialOffset;

    if (options.tangentAmplitude > 1e-4) {
      const tangentialNoise = options.perlin.fbm2((baseX - phaseY) * noiseScale * 0.8, (baseY + phaseX) * noiseScale * 0.8, 3);
      const tangentialOffset = tangentialNoise * options.tangentAmplitude * (0.3 + 0.7 * eased);
      px += tx * tangentialOffset;
      py += ty * tangentialOffset;
    }

    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }

  ctx.stroke();
}

function jitterPoints(points, perlin, noiseScale, spacing, warp, seed) {
  const strength = Math.min(spacing * 0.65, spacing * (0.18 + Math.min(warp, 2) * 0.45));
  if (strength < 1e-4) return points.map((p) => ({ x: p.x, y: p.y }));

  const result = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const phase = seed * 0.017 + i * 11.137;
    const offsetX = perlin.fbm2((p.x * 0.85 + phase) * noiseScale, (p.y - phase * 0.7) * noiseScale, 3);
    const offsetY = perlin.fbm2((p.x - phase * 1.3) * noiseScale, (p.y * 0.92 + phase) * noiseScale, 3);
    result[i] = {
      x: p.x + offsetX * strength,
      y: p.y + offsetY * strength,
    };
  }
  return result;
}

function buildEdges(points, spacing, rng) {
  const maxEdgeLength = Math.max(spacing * 3.2, spacing + 18);
  const desiredBase = 3;
  const desiredExtraChance = 0.32;
  const edges = new Map();

  for (let i = 0; i < points.length; i++) {
    const neighbors = [];
    const pi = points[i];
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const pj = points[j];
      const dx = pj.x - pi.x;
      const dy = pj.y - pi.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-3) continue;
      neighbors.push({ index: j, dist });
    }
    if (!neighbors.length) continue;
    neighbors.sort((a, b) => a.dist - b.dist);

    const desired = desiredBase + (rng() < desiredExtraChance ? 1 : 0);
    let added = 0;

    for (const neighbor of neighbors) {
      if (added >= desired) break;
      if (neighbor.dist > maxEdgeLength && added >= 1) break;
      const key = neighbor.index < i ? `${neighbor.index}|${i}` : `${i}|${neighbor.index}`;
      if (!edges.has(key)) edges.set(key, { a: Math.min(i, neighbor.index), b: Math.max(i, neighbor.index), length: neighbor.dist });
      added++;
    }

    if (added === 0) {
      const first = neighbors[0];
      const key = first.index < i ? `${first.index}|${i}` : `${i}|${first.index}`;
      if (!edges.has(key)) edges.set(key, { a: Math.min(i, first.index), b: Math.max(i, first.index), length: first.dist });
    }
  }

  return Array.from(edges.values());
}

function computeRadialAmplitude(spacing, warp) {
  const w = Math.min(Math.max(warp, 0), 2);
  return Math.max(2.5, spacing * (0.12 + w * 0.45));
}

function computeTangentAmplitude(spacing, warp) {
  const w = Math.min(Math.max(warp, 0), 2);
  return spacing * (0.05 + w * 0.2);
}

function hashEdge(a, b, seed) {
  let h = (a + 1) * 73856093;
  h ^= (b + 1) * 19349663;
  h ^= seed * 83492791;
  h ^= h >>> 13;
  h ^= h << 7;
  return h >>> 0;
}

function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s >>> 8) / 0x00ffffff;
  };
}

function readNumber(input, fallback) {
  if (!input) return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function clampAlpha(value) {
  if (!Number.isFinite(value)) return 0.9;
  if (value < 0.05) return 0.05;
  if (value > 1) return 1;
  return value;
}
