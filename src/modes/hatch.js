import { bbox, pointInPoly } from '../utils/geometry.js';

export function runHatch({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const angle = (Number(controls.hAngle.value) || 0) * Math.PI / 180;
  const spacing = Math.max(2, Number(controls.hSpace.value) || 0);
  const lineWidth = Number(controls.hLW.value) || 1;
  const cross = controls.hCross.checked;
  const rawHighlightScale = controls.hCrossSize ? Number(controls.hCrossSize.value) : 1.05;
  const highlightScale = Number.isFinite(rawHighlightScale) ? rawHighlightScale : 1.05;
  const color = controls.color?.value || '#000000';
  const rawOrganic = controls.hOrganic ? Number(controls.hOrganic.value) : 0.75;
  const organic = clamp01(Number.isFinite(rawOrganic) ? rawOrganic : 0.75);
  const rawSegments = controls.hShearSegments ? Number(controls.hShearSegments.value) : 0;
  const shearSegments = clampInt(Number.isFinite(rawSegments) ? rawSegments : 0, 0, 6);
  const rawOffset = controls.hShearOffset ? Number(controls.hShearOffset.value) : 0;
  const shearOffset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const bounds = bbox(state.pts);
  const pad = Math.hypot(canvas.width, canvas.height);
  const cx = (bounds.minx + bounds.maxx) / 2;
  const cy = (bounds.miny + bounds.maxy) / 2;

  const context = {
    startY: bounds.miny - pad,
    endY: bounds.maxy + pad,
    rangeY: Math.max(1, bounds.maxy - bounds.miny + pad * 2),
    segmentStep: Math.max(6, spacing * 0.35),
    cx,
    cy,
    shear: createShearInfo({
      segments: shearSegments,
      offset: shearOffset,
    }),
  };

  const baseSeed = hashPoints(state.pts);
  const mainSet = buildLineSet({
    angle,
    spacing,
    bounds,
    pad,
    rng: createRng(baseSeed ^ 0x9e3779b9 ^ (Math.floor(angle * 1000) >>> 0)),
    context,
    organic,
  });

  drawLineSet(ctx, mainSet, context, lineWidth);

  if (cross) {
    const crossAngle = angle + Math.PI / 2;
    const crossSet = buildLineSet({
      angle: crossAngle,
      spacing,
      bounds,
      pad,
      rng: createRng(baseSeed ^ 0x51633e2d ^ (Math.floor(crossAngle * 873) >>> 0)),
      context,
      organic,
    });

    drawLineSet(ctx, crossSet, context, lineWidth);
    drawCrossHighlights(ctx, mainSet, crossSet, {
      color,
      lineWidth,
      polygon: state.pts,
      bounds,
      context,
      highlightScale,
    });
  }

  ctx.restore();
}

function buildLineSet({ angle, spacing, bounds, pad, rng, context, organic }) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const lines = [];
  const min = bounds.minx - pad - spacing * 3;
  const max = bounds.maxx + pad + spacing * 3;
  const wobble = clamp01(organic ?? 0.75);
  let pos = min + (rng() - 0.5) * spacing * wobble;
  const guardLimit = 2000;
  let guard = 0;

  while (pos <= max && guard < guardLimit) {
    const base = pos + (rng() - 0.5) * spacing * 0.75 * wobble;
    const line = {
      base,
      tilt: (rng() - 0.5) * spacing * 0.45 * wobble,
      bow: (rng() - 0.5) * spacing * 0.35 * wobble,
      waveAmp: spacing * (0.14 + rng() * 0.22) * wobble,
      waveFreq: (0.7 + rng() * 1.1) / Math.max(160, spacing * 10),
      wavePhase: rng() * Math.PI * 2,
      waveAmp2: spacing * 0.09 * (0.5 + rng() * 0.7) * wobble,
      waveFreq2: (1.4 + rng() * 1.6) / Math.max(220, spacing * 12),
      wavePhase2: rng() * Math.PI * 2,
      weight: 1 + (rng() - 0.5) * 0.22 * (0.35 + wobble * 0.65),
    };
    line.constant = computeLineConstant(line.base, cos, sin, context.cx, context.cy);
    lines.push(line);

    const spacingFactor = 1 + (rng() - 0.5) * 0.6 * wobble;
    pos += spacing * Math.max(0.35, spacingFactor);
    guard++;
  }

  if (!lines.length) {
    const fallback = {
      base: (bounds.minx + bounds.maxx) / 2,
      tilt: 0,
      bow: 0,
      waveAmp: 0,
      waveFreq: 1,
      wavePhase: 0,
      waveAmp2: 0,
      waveFreq2: 1,
      wavePhase2: 0,
      weight: 1,
    };
    fallback.constant = computeLineConstant(fallback.base, cos, sin, context.cx, context.cy);
    lines.push(fallback);
  }

  return { angle, cos, sin, lines };
}

function drawLineSet(ctx, set, context, baseLineWidth) {
  ctx.save();
  ctx.translate(context.cx, context.cy);
  ctx.rotate(set.angle);
  ctx.translate(-context.cx, -context.cy);

  const startY = context.startY;
  const endY = context.endY;
  const step = context.segmentStep;

  for (const line of set.lines) {
    ctx.lineWidth = Math.max(0.2, baseLineWidth * line.weight);
    ctx.beginPath();
    let first = true;
    let y = startY;
    while (y <= endY) {
      const x = evalLineLocalX(line, y, context);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
      y += step;
    }
    if (y - step < endY) {
      const xEnd = evalLineLocalX(line, endY, context);
      ctx.lineTo(xEnd, endY);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawCrossHighlights(ctx, setA, setB, options) {
  const intersections = computeIntersections(setA, setB, options);
  if (!intersections.length) return;

  ctx.save();
  ctx.fillStyle = options.color;
  ctx.globalAlpha = 1;
  const scale = options.highlightScale && Number.isFinite(options.highlightScale)
    ? Math.max(0, options.highlightScale)
    : 1.05;
  for (const inter of intersections) {
    const baseWidth = Math.max(inter.widthA, inter.widthB);
    const radius = Math.max(0.1, baseWidth * scale);
    ctx.beginPath();
    ctx.arc(inter.x, inter.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function computeIntersections(setA, setB, options) {
  const results = [];
  const bounds = options.bounds;
  const margin = Math.max(6, (options.lineWidth || 1) * 4);
  for (const lineA of setA.lines) {
    for (const lineB of setB.lines) {
      const det = setA.cos * setB.sin - setA.sin * setB.cos;
      if (Math.abs(det) < 1e-6) continue;
      const px = (lineA.constant * setB.sin - setA.sin * lineB.constant) / det;
      const py = (-lineA.constant * setB.cos + setA.cos * lineB.constant) / det;
      if (
        px < bounds.minx - margin ||
        px > bounds.maxx + margin ||
        py < bounds.miny - margin ||
        py > bounds.maxy + margin
      ) {
        continue;
      }
      if (!pointInPoly(px, py, options.polygon)) continue;

      const localA = toLocal(px, py, setA.angle, options.context.cx, options.context.cy);
      const localB = toLocal(px, py, setB.angle, options.context.cx, options.context.cy);
      const adjAx = evalLineLocalX(lineA, localA.y, options.context);
      const adjBx = evalLineLocalX(lineB, localB.y, options.context);
      const worldA = toWorld(adjAx, localA.y, setA.angle, options.context.cx, options.context.cy);
      const worldB = toWorld(adjBx, localB.y, setB.angle, options.context.cx, options.context.cy);
      const ix = (worldA.x + worldB.x) * 0.5;
      const iy = (worldA.y + worldB.y) * 0.5;
      results.push({
        x: ix,
        y: iy,
        widthA: Math.max(0.2, options.lineWidth * lineA.weight),
        widthB: Math.max(0.2, options.lineWidth * lineB.weight),
      });
    }
  }
  return results;
}

function evalLineLocalX(line, y, context) {
  const t = (y - context.startY) / context.rangeY;
  const centered = t - 0.5;
  const lean = line.tilt * centered * 1.2;
  const bow = line.bow * (centered * centered - 0.25) * 2.4;
  const wave1 = Math.sin(y * line.waveFreq + line.wavePhase) * line.waveAmp;
  const wave2 = Math.sin(y * line.waveFreq2 + line.wavePhase2) * line.waveAmp2;
  const shearOffset = computeShearOffset(y, context);
  return line.base + lean + bow + wave1 + wave2 + shearOffset;
}

function computeLineConstant(base, cos, sin, cx, cy) {
  return (base - cx) + cos * cx + sin * cy;
}

function toLocal(x, y, angle, cx, cy) {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cos * dx + sin * dy + cx,
    y: -sin * dx + cos * dy + cy,
  };
}

function toWorld(x, y, angle, cx, cy) {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cos * dx - sin * dy + cx,
    y: sin * dx + cos * dy + cy,
  };
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
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value) {
  if (Number.isNaN(value) || value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function createShearInfo({ segments, offset }) {
  const segCount = clampInt(segments ?? 0, 0, 6);
  const shearOffset = Math.max(0, offset ?? 0);
  if (segCount <= 0 || shearOffset <= 0) return null;
  return {
    segments: segCount,
    offset: shearOffset,
  };
}

function computeShearOffset(y, context) {
  const shear = context?.shear;
  if (!shear) return 0;
  const clampedSegs = Math.max(1, shear.segments);
  const normalized = (y - context.startY) / context.rangeY;
  const clamped = Math.max(0, Math.min(0.999999, normalized));
  const bandIndex = Math.floor(clamped * clampedSegs);
  return bandIndex * shear.offset;
}
