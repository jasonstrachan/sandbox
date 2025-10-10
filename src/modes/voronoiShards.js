import { polygonCentroid, linePolyIntersections } from '../utils/geometry.js';

export function runVoronoiShards({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const polygon = state.pts;
  if (!polygon || polygon.length < 3) return;

  const color = controls.color?.value || '#000000';
  const strokeWidth = Math.max(0.25, readNumber(controls.strokeLW, 1.4));
  const spacingDiv = Math.max(3, readNumber(controls.vorShardsSpacingDiv, 24));
  const spacingMin = Math.max(2, readNumber(controls.vorShardsSpacingMin, 18));
  const lineSpacingBase = Math.max(2, readNumber(controls.vorShardsLineSpacing, 8));
  const jitterAmount = clamp01(readNumber(controls.vorShardsJitter, 0.45));
  const angleBaseDeg = readNumber(controls.vorShardsAngle, 18);
  const angleJitterDeg = Math.max(0, readNumber(controls.vorShardsAngleJitter, 32));
  const gradientMix = clamp01(readNumber(controls.vorShardsGradient, 0.35));

  const baseSeed = hashPoints(polygon);
  const seedingRng = createRng(baseSeed ^ 0x9e3779b9);
  const hatchRng = createRng(baseSeed ^ 0x51633e2d);

  const seeds = generateSeeds(polygon, spacingDiv, spacingMin, jitterAmount, seedingRng);
  if (seeds.length < 3) return;

  const cells = computeVoronoiCells(seeds, polygon);
  if (!cells.length) return;

  const polygonCenter = polygonCentroid(polygon);
  cells.sort((a, b) => b.area - a.area);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const cell of cells) {
    if (cell.area < 6 || cell.points.length < 3) continue;
    drawCell(ctx, {
      cell,
      color,
      strokeWidth,
      baseAngle: toRadians(angleBaseDeg),
      angleJitter: toRadians(angleJitterDeg),
      lineSpacing: lineSpacingBase,
      jitterAmount,
      gradientMix,
      rng: hatchRng,
      polygonCenter,
    });
  }

  ctx.restore();
}

function drawCell(ctx, options) {
  const { cell, color, strokeWidth, baseAngle, angleJitter, lineSpacing, jitterAmount, gradientMix, rng, polygonCenter } = options;
  const centroid = cell.centroid;

  const posAngle = Math.atan2(centroid.y - polygonCenter.y, centroid.x - polygonCenter.x);
  const angle = baseAngle + (posAngle * 0.15) + (rng() - 0.5) * angleJitter;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const perp = { x: -dir.y, y: dir.x };

  const cellSpacing = Math.max(1.5, lineSpacing * (0.85 + (rng() - 0.5) * 0.9 * jitterAmount));
  const minProj = Math.min(...cell.points.map((p) => dot(p, perp)));
  const maxProj = Math.max(...cell.points.map((p) => dot(p, perp)));
  const startOffset = Math.floor((minProj - cellSpacing * 2) / cellSpacing) * cellSpacing;

  ctx.save();
  tracePolygonPath(ctx, cell.points);
  ctx.clip('nonzero');

  if (gradientMix > 0.001) {
    const alongMin = Math.min(...cell.points.map((p) => dot(p, dir)));
    const alongMax = Math.max(...cell.points.map((p) => dot(p, dir)));
    const extent = Math.max(16, (alongMax - alongMin) * 0.5 + cellSpacing * 2);
    const gradient = ctx.createLinearGradient(
      centroid.x - dir.x * extent,
      centroid.y - dir.y * extent,
      centroid.x + dir.x * extent,
      centroid.y + dir.y * extent,
    );
    gradient.addColorStop(0, colorWithAlpha(color, gradientMix * 0.15));
    gradient.addColorStop(0.5, colorWithAlpha(color, gradientMix * 0.6));
    gradient.addColorStop(1, colorWithAlpha(color, gradientMix * 0.08));
    ctx.fillStyle = gradient;
    ctx.globalAlpha = Math.min(0.8, gradientMix);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.2, strokeWidth * (0.85 + (rng() - 0.5) * 0.4));

  for (let offset = startOffset; offset <= maxProj + cellSpacing * 2; offset += cellSpacing) {
    const jittered = offset + (rng() - 0.5) * cellSpacing * jitterAmount * 0.9;
    const basePoint = {
      x: perp.x * jittered,
      y: perp.y * jittered,
    };
    const intersections = linePolyIntersections(basePoint, dir, cell.points);
    if (intersections.length < 2) continue;
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const t0 = intersections[i];
      const t1 = intersections[i + 1];
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
      const x0 = basePoint.x + dir.x * t0;
      const y0 = basePoint.y + dir.y * t0;
      const x1 = basePoint.x + dir.x * t1;
      const y1 = basePoint.y + dir.y * t1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function computeVoronoiCells(seeds, polygon) {
  const cells = [];
  for (let i = 0; i < seeds.length; i++) {
    let cell = polygon.map(clonePoint);
    const seed = seeds[i];
    for (let j = 0; j < seeds.length; j++) {
      if (i === j) continue;
      const other = seeds[j];
      const normal = { x: other.x - seed.x, y: other.y - seed.y };
      const offset = 0.5 * ((other.x * other.x + other.y * other.y) - (seed.x * seed.x + seed.y * seed.y));
      cell = clipPolygonHalfPlane(cell, normal, offset);
      if (cell.length === 0) break;
    }
    if (cell.length < 3) continue;
    cell = dedupePolygon(cell);
    if (cell.length < 3) continue;
    const area = Math.abs(polygonArea(cell));
    if (area < 4) continue;
    cells.push({
      points: cell,
      centroid: polygonCentroid(cell),
      area,
    });
  }
  return cells;
}

function generateSeeds(polygon, spacingDiv, spacingMin, jitterAmount, rng) {
  const seeds = [];
  const n = polygon.length;
  if (n < 2) return seeds;

  const perimeter = polygonPerimeter(polygon);
  if (perimeter < 1) return seeds;

  const baseSpacing = Math.max(spacingMin, perimeter / spacingDiv);
  const centroid = polygonCentroid(polygon);
  const inwardOffset = Math.min(baseSpacing * 0.35, 28);

  let targetDist = rng() * baseSpacing;
  let travelled = 0;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const edgeLength = Math.hypot(b.x - a.x, b.y - a.y);
    if (edgeLength < 1e-5) {
      travelled += edgeLength;
      continue;
    }

    while (targetDist <= travelled + edgeLength) {
      let t = (targetDist - travelled) / edgeLength;
      if (!Number.isFinite(t)) break;
      t += (rng() - 0.5) * 0.6 * jitterAmount;
      t = clamp(t, 0.03, 0.97);
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const dir = normalize({ x: centroid.x - x, y: centroid.y - y });
      const offsetMag = inwardOffset * (0.3 + rng() * 0.9);
      seeds.push({
        x: x + dir.x * offsetMag,
        y: y + dir.y * offsetMag,
      });

      const stepAdjust = baseSpacing * (0.85 + (rng() - 0.5) * 0.9 * jitterAmount);
      targetDist += Math.max(2, stepAdjust);
    }

    travelled += edgeLength;
  }

  if (seeds.length < n) {
    for (let i = 0; i < n; i++) {
      const v = polygon[i];
      const dir = normalize({ x: centroid.x - v.x, y: centroid.y - v.y });
      const offsetMag = inwardOffset * (0.15 + rng() * 0.6);
      seeds.push({
        x: v.x + dir.x * offsetMag,
        y: v.y + dir.y * offsetMag,
      });
    }
  }

  seeds.push(centroid);
  return seeds;
}

function clipPolygonHalfPlane(points, normal, offset) {
  const result = [];
  if (!points.length) return result;

  const length = Math.hypot(normal.x, normal.y);
  if (length < 1e-9) return result;
  const norm = { x: normal.x / length, y: normal.y / length };
  const scaledOffset = offset / length;

  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const currentInside = dot(current, norm) <= scaledOffset + 1e-6;
    const nextInside = dot(next, norm) <= scaledOffset + 1e-6;

    if (currentInside && nextInside) {
      result.push(clonePoint(next));
    } else if (currentInside && !nextInside) {
      const intersection = segmentPlaneIntersection(current, next, norm, scaledOffset);
      if (intersection) result.push(intersection);
    } else if (!currentInside && nextInside) {
      const intersection = segmentPlaneIntersection(current, next, norm, scaledOffset);
      if (intersection) {
        result.push(intersection);
        result.push(clonePoint(next));
      }
    }
  }

  return result;
}

function segmentPlaneIntersection(a, b, normal, offset) {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const denom = dot(ab, normal);
  if (Math.abs(denom) < 1e-9) return null;
  const t = (offset - dot(a, normal)) / denom;
  if (t < -1e-6 || t > 1 + 1e-6) return null;
  return {
    x: a.x + ab.x * t,
    y: a.y + ab.y * t,
  };
}

function polygonPerimeter(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

function dedupePolygon(points) {
  if (points.length <= 2) return points;
  const result = [];
  const eps = 1e-4;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const last = result[result.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > eps) {
      result.push(clonePoint(p));
    }
  }
  if (result.length >= 2) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < eps) {
      result.pop();
    }
  }
  return result;
}

function tracePolygonPath(ctx, points) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function normalize(vector) {
  const len = Math.hypot(vector.x, vector.y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: vector.x / len, y: vector.y / len };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function clonePoint(p) {
  return { x: p.x, y: p.y };
}

function hashPoints(points) {
  let hash = 2166136261;
  for (const pt of points) {
    hash ^= Math.round(pt.x * 16);
    hash = Math.imul(hash, 16777619);
    hash ^= Math.round(pt.y * 16);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  let state = seed >>> 0;
  if (!state) state = 0x6d2b79f5;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state >>> 8) / 0x00ffffff;
  };
}

function readNumber(input, fallback) {
  if (!input) return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function toRadians(deg) {
  return (deg || 0) * Math.PI / 180;
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function colorWithAlpha(color, alpha) {
  const clamped = clamp01(alpha);
  if (!color || !color.startsWith('#')) return color;
  let hex = color.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}
