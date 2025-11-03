import { bbox, pointInPoly } from '../utils/geometry.js';

export function runHatch(deps) {
  const { controls, helpers } = deps;
  if (!helpers.ensureClosed()) return;
  const settings = readHatchSettings(controls);
  renderHatch(deps, settings);
}

export function renderHatch({ canvas, ctx, state, helpers }, rawSettings) {
  const angle = Number.isFinite(rawSettings?.angleRad) ? rawSettings.angleRad : 0;
  const spacing = Math.max(2, Number.isFinite(rawSettings?.spacing) ? rawSettings.spacing : 0);
  const lineWidth = Number.isFinite(rawSettings?.lineWidth) ? rawSettings.lineWidth : 1;
  const cross = Boolean(rawSettings?.cross);
  const highlightScale = Number.isFinite(rawSettings?.highlightScale) ? rawSettings.highlightScale : 1.05;
  const color = typeof rawSettings?.color === 'string' && rawSettings.color.length
    ? rawSettings.color
    : '#000000';
  const organic = clamp01(Number.isFinite(rawSettings?.organic) ? rawSettings.organic : 0.75);
  const shearSegments = clampInt(Number.isFinite(rawSettings?.shearSegments) ? rawSettings.shearSegments : 0, 0, 6);
  const shearOffset = Math.max(0, Number.isFinite(rawSettings?.shearOffset) ? rawSettings.shearOffset : 0);

  helpers.prepareRender();

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

  const baseContext = {
    startY: bounds.miny - pad,
    endY: bounds.maxy + pad,
    rangeY: Math.max(1, bounds.maxy - bounds.miny + pad * 2),
    segmentStep: Math.max(6, spacing * 0.35),
    cx,
    cy,
    spacing,
  };

  const contextMain = {
    ...baseContext,
    shear: createShearInfo({
      segments: shearSegments,
      offset: shearOffset,
      minAxis: bounds.miny,
      maxAxis: bounds.maxy,
    }),
  };
  const contextCross = {
    ...baseContext,
    shear: null,
  };

  const baseSeed = hashPoints(state.pts);
  const mainSet = buildLineSet({
    angle,
    spacing,
    bounds,
    pad,
    rng: createRng(baseSeed ^ 0x9e3779b9 ^ (Math.floor(angle * 1000) >>> 0)),
    context: contextMain,
    organic,
  });

  drawLineSet(ctx, mainSet, contextMain, lineWidth);

  if (cross) {
    const crossAngle = angle + Math.PI / 2;
    const crossSet = buildLineSet({
      angle: crossAngle,
      spacing,
      bounds,
      pad,
      rng: createRng(baseSeed ^ 0x51633e2d ^ (Math.floor(crossAngle * 873) >>> 0)),
      context: contextCross,
      organic,
    });

    drawLineSet(ctx, crossSet, contextCross, lineWidth);
    drawCrossHighlights(ctx, mainSet, crossSet, {
      color,
      lineWidth,
      polygon: state.pts,
      bounds,
      contextA: contextMain,
      contextB: contextCross,
      highlightScale,
    });
  }

  ctx.restore();
}

function readHatchSettings(controls) {
  const angleDeg = readNumber(controls?.hAngle?.value, 0);
  const spacing = Math.max(2, readNumber(controls?.hSpace?.value, 0));
  const lineWidth = readNumber(controls?.hLW?.value, 1);
  const cross = Boolean(controls?.hCross?.checked);
  const highlightScaleRaw = readNumber(controls?.hCrossSize?.value, 1.05);
  const organicRaw = readNumber(controls?.hOrganic?.value, 0.75);
  const segmentsRaw = readNumber(controls?.hShearSegments?.value, 0);
  const offsetRaw = readNumber(controls?.hShearOffset?.value, 0);
  const color = controls?.color?.value || '#000000';

  return {
    angleRad: angleDeg * Math.PI / 180,
    spacing,
    lineWidth,
    cross,
    highlightScale: Number.isFinite(highlightScaleRaw) ? highlightScaleRaw : 1.05,
    color,
    organic: clamp01(Number.isFinite(organicRaw) ? organicRaw : 0.75),
    shearSegments: clampInt(Number.isFinite(segmentsRaw) ? segmentsRaw : 0, 0, 6),
    shearOffset: Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0),
  };
}

function readNumber(raw, defaultValue) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : defaultValue;
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
    const lineSeed = Math.max(1, Math.floor(rng() * 0xffffffff));
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
      seed: lineSeed,
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
      seed: 0xa3617d29,
    };
    fallback.constant = computeLineConstant(fallback.base, cos, sin, context.cx, context.cy);
    lines.push(fallback);
  }

  assignLineShearSegments(lines, context, context.shear);

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
    const segments = line.shearSegments && line.shearSegments.length
      ? line.shearSegments
      : [{
          start: startY,
          end: endY,
          startShift: 0,
          endShift: 0,
          jitterAmp: 0,
          jitterFreq: 1,
          jitterPhase: 0,
        }];

    ctx.lineWidth = Math.max(0.2, baseLineWidth * line.weight);
    for (const segment of segments) {
      const segStart = Math.max(segment.start, startY);
      const segEnd = Math.min(segment.end, endY);
      if (segStart >= segEnd) continue;

      ctx.beginPath();
      let first = true;
      let y = segStart;
      while (y <= segEnd) {
        const x = evalLineLocalX(line, y, context);
        const shift = getLineShearShift(line, y);
        const drawX = x + shift;
        if (first) {
          ctx.moveTo(drawX, y);
          first = false;
        } else {
          ctx.lineTo(drawX, y);
        }
        y += step;
      }
      if (y - step < segEnd) {
        const xEnd = evalLineLocalX(line, segEnd, context);
        const shiftEnd = getLineShearShift(line, segEnd);
        ctx.lineTo(xEnd + shiftEnd, segEnd);
      }
      if (!first) {
        ctx.stroke();
      }
    }
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
  const contextA = options.contextA;
  const contextB = options.contextB || contextA;
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

      const localA = toLocal(px, py, setA.angle, contextA.cx, contextA.cy);
      const localB = toLocal(px, py, setB.angle, contextB.cx, contextB.cy);
      const adjAx = evalLineLocalX(lineA, localA.y, contextA);
      const adjBx = evalLineLocalX(lineB, localB.y, contextB);
      const shiftA = getLineShearShift(lineA, localA.y);
      const shiftB = getLineShearShift(lineB, localB.y);
      const worldA = toWorld(adjAx + shiftA, localA.y, setA.angle, contextA.cx, contextA.cy);
      const worldB = toWorld(adjBx + shiftB, localB.y, setB.angle, contextB.cx, contextB.cy);
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
  return line.base + lean + bow + wave1 + wave2;
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

function createShearInfo({ segments, offset, minAxis, maxAxis }) {
  const segCount = clampInt(segments ?? 0, 0, 6);
  const shearOffset = Math.max(0, offset ?? 0);
  if (segCount <= 0 || shearOffset <= 0) return null;
  const min = Number.isFinite(minAxis) ? minAxis : null;
  const max = Number.isFinite(maxAxis) ? maxAxis : null;
  if (min == null || max == null || max <= min) return null;
  return {
    segments: segCount,
    offset: shearOffset,
    min,
    max,
  };
}

function assignLineShearSegments(lines, context, shear) {
  if (!Array.isArray(lines) || !lines.length) return;
  if (!shear) {
    for (const line of lines) {
      delete line.shearSegments;
      delete line.shearBounds;
    }
    return;
  }

  const span = shear.max - shear.min;
  if (!(span > 0)) {
    for (const line of lines) {
      delete line.shearSegments;
      delete line.shearBounds;
    }
    return;
  }

  const segCount = Math.max(1, shear.segments);
  const baseHeight = span / segCount;
  const spacingHint = context?.spacing ?? 0;
  const baseJitter = Math.min(0.5, Math.max(0.05, spacingHint * 0.05));

  for (const line of lines) {
    const rng = createRng((line.seed ?? 0x9e3779b9) ^ 0x7f4a7c15);
    const segments = [];
    let currentShift = 0;
    for (let i = 0; i < segCount; i++) {
      const segStart = shear.min + baseHeight * i;
      const segEnd = i === segCount - 1 ? shear.max : segStart + baseHeight;
      const strength = 0.85 + rng() * 0.3;
      const deltaShift = shear.offset * strength;
      const nextShift = currentShift + deltaShift;
      const jitterAmp = baseJitter * (0.35 + rng() * 0.45);
      const jitterFreq = 0.3 + rng() * 0.8;
      const jitterPhase = rng() * Math.PI * 2;
      segments.push({
        start: segStart,
        end: segEnd,
        startShift: currentShift,
        endShift: nextShift,
        jitterAmp,
        jitterFreq,
        jitterPhase,
      });
      currentShift = nextShift;
    }

    line.shearSegments = segments;
    line.shearBounds = { min: shear.min, max: shear.max };
  }
}

function getLineShearShift(line, y) {
  const segments = line?.shearSegments;
  if (!segments) return 0;
  const bounds = line?.shearBounds;
  if (!bounds) return 0;
  if (y < bounds.min || y > bounds.max) return 0;
  const CUT_WIDTH = 1;
  for (const segment of segments) {
    if (y >= segment.start && y <= segment.end) {
      const cutBoundary = Math.min(segment.end, segment.start + CUT_WIDTH);
      const baseShift = y >= cutBoundary ? segment.endShift : segment.startShift;
      const span = Math.max(segment.end - segment.start, 1e-4);
      const waveT = Math.max(0, Math.min(1, (y - segment.start) / span));
      const wave = Math.sin((waveT * segment.jitterFreq * Math.PI * 2) + segment.jitterPhase);
      const mix = y < cutBoundary ? 0 : Math.max(0, Math.min(1, (y - cutBoundary) / (span - (cutBoundary - segment.start) + 1e-4)));
      return baseShift + wave * segment.jitterAmp * mix;
    }
  }
  return 0;
}
