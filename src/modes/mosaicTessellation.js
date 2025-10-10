import { polygonCentroid } from '../utils/geometry.js';
import { poissonInPolygon } from '../utils/seeding.js';

export function runMosaicTessellation({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const polygon = state.pts;
  if (!polygon || polygon.length < 3) return;

  const baseColor = controls.color?.value || '#dcdfe7';
  const outlineWidth = Math.max(0.4, readNumber(controls.mosaicOutline, 2));
  const spacing = Math.max(8, readNumber(controls.mosaicSpacing, 46));
  const relaxIterations = clampInt(readNumber(controls.mosaicRelax, 3), 0, 12);
  const hexRatio = clamp01(readNumber(controls.mosaicHexRatio, 0.7));
  const jitter = clamp01(readNumber(controls.mosaicJitter, 0.35));
  const shadeVariance = clamp01(readNumber(controls.mosaicShade, 0.6));
  const seedValue = Math.round(readNumber(controls.mosaicSeed, 1337));

  const baseSeed = (hashPoints(polygon) ^ (seedValue >>> 0)) >>> 0;
  const poissonRng = createRng(baseSeed ^ 0x1f123bb5);

  let seeds = poissonInPolygon(spacing, polygon, canvas.width, canvas.height, poissonRng);
  if (seeds.length < 6) {
    const centroid = polygonCentroid(polygon);
    seeds.push(centroid);
    const n = polygon.length;
    for (let i = 0; seeds.length < 6 && i < n; i++) {
      const v = polygon[i];
      seeds.push({
        x: (v.x * 0.7 + centroid.x * 0.3) + (poissonRng() - 0.5) * spacing * 0.3,
        y: (v.y * 0.7 + centroid.y * 0.3) + (poissonRng() - 0.5) * spacing * 0.3,
      });
    }
  }
  if (seeds.length < 3) return;

  let cells = computeVoronoiCells(seeds, polygon);
  for (let iter = 0; iter < relaxIterations && cells.length; iter++) {
    seeds = cells.map((cell) => cell.centroid);
    cells = computeVoronoiCells(seeds, polygon);
  }

  if (!cells.length) return;

  const fillRng = createRng(baseSeed ^ 0x9e3779b9);
  const shapeRng = createRng(baseSeed ^ 0x51633e2d);
  const highlightColor = mixWithWhite(hexToRgb(baseColor), 0.55);
  const outlineColor = darkenColor(baseColor, 0.45);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const cell of cells) {
    if (cell.area < 18 || !cell.points?.length) continue;
    const shard = buildShard(cell, { hexRatio, jitter, rng: shapeRng });
    if (shard.length < 3) continue;

    const varianceNudge = (fillRng() - 0.5) * shadeVariance;
    const outlineAlpha = clamp01(0.78 + varianceNudge * 0.3);
    const highlightAlpha = clamp01(0.42 + varianceNudge * 0.45);

    drawPolygon(ctx, shard);
    ctx.strokeStyle = rgbaFromHex(outlineColor, outlineAlpha);
    ctx.lineWidth = outlineWidth;
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.stroke();

    drawPolygon(ctx, shard);
    ctx.strokeStyle = rgbaFromRgb(highlightColor, highlightAlpha);
    ctx.lineWidth = Math.max(0.4, outlineWidth * 0.4);
    ctx.globalAlpha = 0.65;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function buildShard(cell, { hexRatio, jitter, rng }) {
  const type = rng() < hexRatio ? 'hex' : 'tri';
  const sides = type === 'hex' ? 6 : 3;
  const angleStep = (Math.PI * 2) / sides;
  const orientation = rng() * Math.PI * 2;
  const baseRadius = Math.sqrt(Math.abs(cell.area)) * (type === 'hex' ? 0.75 : 0.95);
  const raw = [];
  for (let i = 0; i < sides; i++) {
    const angle = orientation + angleStep * i;
    const radius = baseRadius * (0.9 + (rng() - 0.5) * jitter * 0.9);
    raw.push({
      x: cell.centroid.x + Math.cos(angle) * radius,
      y: cell.centroid.y + Math.sin(angle) * radius,
    });
  }

  let clipped = clipPolygon(raw, cell.points);
  if (!clipped.length) clipped = cell.points.map(clonePoint);

  const shrink = 0.9 - jitter * 0.2;
  const adjusted = clipped.map((pt) => ({
    x: cell.centroid.x + (pt.x - cell.centroid.x) * shrink,
    y: cell.centroid.y + (pt.y - cell.centroid.y) * shrink,
  }));

  const jitterAmount = jitter * 0.35;
  for (const pt of adjusted) {
    pt.x += (rng() - 0.5) * jitterAmount * 12;
    pt.y += (rng() - 0.5) * jitterAmount * 12;
  }

  return dedupePolygon(adjusted);
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
      if (!cell.length) break;
    }
    if (cell.length < 3) continue;
    cell = dedupePolygon(cell);
    if (cell.length < 3) continue;
    const area = Math.abs(polygonArea(cell));
    if (area < 6) continue;
    cells.push({
      points: cell,
      centroid: polygonCentroid(cell),
      area,
    });
  }
  return cells;
}

function drawPolygon(ctx, pts) {
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
}

function clipPolygon(subject, clipper) {
  let output = subject.map(clonePoint);
  if (!output.length || !clipper.length) return [];
  for (let i = 0; i < clipper.length; i++) {
    const a = clipper[i];
    const b = clipper[(i + 1) % clipper.length];
    const input = output;
    output = [];
    if (!input.length) break;
    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const next = input[(j + 1) % input.length];
      const currentInside = isLeft(a, b, current) >= -1e-6;
      const nextInside = isLeft(a, b, next) >= -1e-6;
      if (currentInside && nextInside) {
        output.push(clonePoint(next));
      } else if (currentInside && !nextInside) {
        const intersection = segmentIntersection(current, next, a, b);
        if (intersection) output.push(intersection);
      } else if (!currentInside && nextInside) {
        const intersection = segmentIntersection(current, next, a, b);
        if (intersection) output.push(intersection);
        output.push(clonePoint(next));
      }
    }
  }
  return output;
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

function segmentIntersection(p0, p1, a, b) {
  const s10x = p1.x - p0.x;
  const s10y = p1.y - p0.y;
  const s32x = b.x - a.x;
  const s32y = b.y - a.y;
  const denom = s10x * s32y - s32x * s10y;
  if (Math.abs(denom) < 1e-9) return null;
  const s02x = p0.x - a.x;
  const s02y = p0.y - a.y;
  const t = (s02x * s32y - s32x * s02y) / denom;
  if (t < -1e-6 || t > 1 + 1e-6) return null;
  return {
    x: p0.x + t * s10x,
    y: p0.y + t * s10y,
  };
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
  const eps = 1e-3;
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

function isLeft(a, b, p) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function clonePoint(pt) {
  return { x: pt.x, y: pt.y };
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
  if (!input || typeof input.value === 'undefined') return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return { r: 220, g: 223, b: 231 };
  let text = hex.trim();
  if (!text) return { r: 220, g: 223, b: 231 };
  if (text[0] === '#') text = text.slice(1);
  if (text.length === 3) {
    text = text
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (text.length !== 6) return { r: 220, g: 223, b: 231 };
  const r = Number.parseInt(text.slice(0, 2), 16);
  const g = Number.parseInt(text.slice(2, 4), 16);
  const b = Number.parseInt(text.slice(4, 6), 16);
  if ([r, g, b].some((component) => Number.isNaN(component))) {
    return { r: 220, g: 223, b: 231 };
  }
  return { r, g, b };
}

function mixWithWhite(rgb, factor) {
  const f = clamp01(factor);
  return {
    r: Math.round(rgb.r + (255 - rgb.r) * f),
    g: Math.round(rgb.g + (255 - rgb.g) * f),
    b: Math.round(rgb.b + (255 - rgb.b) * f),
  };
}

function rgbaFromRgb(rgb, alpha) {
  const a = clamp01(alpha);
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${a})`;
}

function rgbaFromHex(hex, alpha) {
  const rgb = hexToRgb(hex);
  return rgbaFromRgb(rgb, alpha);
}

function darkenColor(hex, amount) {
  const rgb = hexToRgb(hex);
  const factor = 1 - clamp01(amount);
  return rgbToHex({
    r: rgb.r * factor,
    g: rgb.g * factor,
    b: rgb.b * factor,
  });
}

function rgbToHex({ r, g, b }) {
  const toHex = (value) => {
    const v = Math.max(0, Math.min(255, Math.round(value)));
    return v.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
