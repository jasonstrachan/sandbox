import { poissonInPolygon } from '../utils/seeding.js';

const TAU = Math.PI * 2;

export function runHanddrawnCircles({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const spacing = Math.max(4, readNumber(controls.handCirclesSpacing, 24));
  const sizeRatio = clamp(readNumber(controls.handCirclesSizeRatio, 1), 0.2, 1.6);
  const sizeJitter = clamp01(readNumber(controls.handCirclesSizeJitter, 0.12));
  const wobbleAmount = clamp01(readNumber(controls.handCirclesWobble, 0.22));
  const seed = readInt(controls.handCirclesSeed, 0);
  const strokeWidth = Math.max(0.1, readNumber(controls.strokeLW, 1.5));
  const color = controls.color?.value || '#ffffff';
  const fillEnabled = controls.handCirclesFill ? !!controls.handCirclesFill.checked : true;

  const rng = createRng(seed);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const samples = poissonInPolygon(spacing, state.pts, canvas.width, canvas.height, rng);

  if (!samples.length) {
    ctx.restore();
    return;
  }

  const baseRadius = Math.max(1.5, spacing * 0.5 * sizeRatio);
  const strokeJitter = strokeWidth * 0.25;
  const neighborLimits = fillEnabled ? computeNeighborLimits(samples) : null;

  for (let idx = 0; idx < samples.length; idx++) {
    const sample = samples[idx];
    const jitterFactor = (rng() - 0.5) * 2 * sizeJitter;
    const baseRandomRadius = Math.max(0.6, baseRadius * (1 + jitterFactor));

    let radius = baseRandomRadius;
    if (fillEnabled) {
      const fillBoost = spacing * (0.22 + rng() * 0.14);
      const targetRadius = Math.max(baseRandomRadius + fillBoost, baseRadius + spacing * 0.2);
      const limit = neighborLimits ? neighborLimits[idx] : Infinity;
      if (Number.isFinite(limit)) {
        radius = Math.min(targetRadius, Math.max(0.6, limit));
      } else {
        radius = Math.max(targetRadius, 0.6);
      }
    }
    const wobble = radius * wobbleAmount;

    ctx.save();
    const strokeAlpha = 1;
    const lineWidth = Math.max(0.2, strokeWidth + (rng() - 0.5) * 2 * strokeJitter);

    const strokeStyle = colorWithAlpha(color, strokeAlpha);

    const circleShape = drawWobblyCircle(ctx, sample.x, sample.y, radius, wobble, rng);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    if (circleShape && circleShape.startPoint && rng() < 0.3) {
      const dotAlpha = 1;
      const dotStyle = colorWithAlpha(color, dotAlpha);
      const dotRadius = Math.max(
        0.35,
        Math.min(circleShape.radius * 0.16, lineWidth * (0.9 + rng() * 0.5))
      );
      const baseX = circleShape.startPoint.x;
      const baseY = circleShape.startPoint.y;
      const radialX = baseX - sample.x;
      const radialY = baseY - sample.y;
      const radialLen = Math.hypot(radialX, radialY);
      if (!radialLen) {
        ctx.restore();
        continue;
      }
      const radialDirX = radialX / radialLen;
      const radialDirY = radialY / radialLen;
      const tangentX = -radialDirY;
      const tangentY = radialDirX;
      const tangentRange = Math.min(circleShape.radius * 0.24, dotRadius * 2.4);
      const tangentOffset = (rng() - 0.5) * tangentRange;

      let dotX = baseX + tangentX * tangentOffset;
      let dotY = baseY + tangentY * tangentOffset;

      const tangentComponent =
        (dotX - sample.x) * tangentX + (dotY - sample.y) * tangentY;
      const radialInset = Math.min(lineWidth * 0.55, dotRadius * 0.9);
      let targetRadius = Math.max(
        dotRadius * 0.6,
        radialLen - radialInset +
          (rng() - 0.5) * Math.min(lineWidth, dotRadius) * 0.25
      );

      dotX = sample.x + radialDirX * targetRadius + tangentX * tangentComponent;
      dotY = sample.y + radialDirY * targetRadius + tangentY * tangentComponent;

      ctx.fillStyle = dotStyle;
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  ctx.restore();
}

function drawWobblyCircle(ctx, cx, cy, radius, wobble, rng) {
  const smoothness = Math.min(0.9, wobble / Math.max(1, radius));
  const segments = Math.min(160, Math.max(40, Math.floor(radius * 1.4)));
  const tilt = rng() * TAU;
  const scaleBias = smoothness * 0.65;
  const scaleX = 1 + (rng() - 0.5) * scaleBias;
  const scaleY = 1 + (rng() - 0.5) * scaleBias;

  const baseAmp = wobble * (0.55 + rng() * 0.35);
  const amp2 = wobble * (0.25 + rng() * 0.25);
  const amp3 = wobble * 0.18;
  const freq1 = 1 + rng() * 1.1;
  const freq2 = 2.2 + rng() * 1.8;
  const freq3 = 3.8 + rng() * 2.6;
  const phase1 = rng() * TAU;
  const phase2 = rng() * TAU;
  const phase3 = rng() * TAU;

  const points = new Array(segments);
  let radiusSum = 0;
  for (let i = 0; i < segments; i++) {
    const ang = (i / segments) * TAU;
    let r = radius;
    if (wobble > 1e-4) {
      r += Math.sin(ang * freq1 + phase1) * baseAmp;
      r += Math.sin(ang * freq2 + phase2) * amp2;
      r += Math.cos(ang * freq3 + phase3) * amp3;
    }
    r = Math.max(0.25, r);

    const theta = ang + tilt;
    const x = cx + Math.cos(theta) * r * scaleX;
    const y = cy + Math.sin(theta) * r * scaleY;
    points[i] = { x, y };
    radiusSum += Math.hypot(x - cx, y - cy);
  }

  const avgRadius = radiusSum / Math.max(1, segments);
  const startIndex = (rng() * segments) | 0;
  const startPoint = points[startIndex];
  const nextPoint = points[(startIndex + 1) % segments];
  const prevPoint = points[(startIndex - 1 + segments) % segments];

  let dirOutX = nextPoint.x - startPoint.x;
  let dirOutY = nextPoint.y - startPoint.y;
  let lenOut = Math.hypot(dirOutX, dirOutY) || 1;
  dirOutX /= lenOut;
  dirOutY /= lenOut;
  const startNormalX = -dirOutY;
  const startNormalY = dirOutX;

  let dirInX = startPoint.x - prevPoint.x;
  let dirInY = startPoint.y - prevPoint.y;
  let lenIn = Math.hypot(dirInX, dirInY) || 1;
  dirInX /= lenIn;
  dirInY /= lenIn;
  const endNormalX = dirInY;
  const endNormalY = -dirInX;

  const startTailLen = Math.max(0.35, avgRadius * (0.09 + rng() * 0.05));
  const endTailLen = Math.max(0.45, avgRadius * (0.1 + rng() * 0.06));
  const startCurve = startTailLen * 0.35 * (rng() - 0.5);
  const endCurve = endTailLen * 0.35 * (rng() - 0.5);
  const tailStartX = startPoint.x - dirOutX * startTailLen + startNormalX * startCurve;
  const tailStartY = startPoint.y - dirOutY * startTailLen + startNormalY * startCurve;
  const tailEndX = startPoint.x + dirInX * endTailLen + endNormalX * endCurve;
  const tailEndY = startPoint.y + dirInY * endTailLen + endNormalY * endCurve;

  ctx.beginPath();
  ctx.moveTo(tailStartX, tailStartY);
  ctx.lineTo(startPoint.x, startPoint.y);
  for (let i = 1; i <= segments; i++) {
    const idx = (startIndex + i) % segments;
    const p = points[idx];
    ctx.lineTo(p.x, p.y);
  }
  ctx.lineTo(tailEndX, tailEndY);

  const inwardVecX = cx - startPoint.x;
  const inwardVecY = cy - startPoint.y;
  const inwardLen = Math.hypot(inwardVecX, inwardVecY);

  return {
    radius: avgRadius,
    startPoint,
    inward: inwardLen > 1e-5 ? { x: inwardVecX / inwardLen, y: inwardVecY / inwardLen } : null,
  };
}

function computeNeighborLimits(samples) {
  const n = samples.length;
  if (n <= 1) return new Array(n).fill(Infinity);

  const limits = new Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const si = samples[i];
    for (let j = i + 1; j < n; j++) {
      const sj = samples[j];
      const dx = si.x - sj.x;
      const dy = si.y - sj.y;
      const dist = Math.hypot(dx, dy);
      if (dist < limits[i]) limits[i] = dist;
      if (dist < limits[j]) limits[j] = dist;
    }
  }

  for (let k = 0; k < n; k++) {
    const dist = limits[k];
    if (!Number.isFinite(dist)) {
      limits[k] = Infinity;
    } else {
      const margin = Math.max(0.02, dist * 0.0025);
      limits[k] = Math.max(0.6, dist * 0.5 - margin);
    }
  }

  return limits;
}

function readNumber(input, fallback) {
  if (!input) return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function readInt(input, fallback) {
  return readNumber(input, fallback) | 0;
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function createRng(seed) {
  let s = seed >>> 0;
  if (!s) s = 0x6d2b79f5;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s >>> 8) / 0x00ffffff;
  };
}

function colorWithAlpha(color, alpha) {
  if (!color) return `rgba(255, 255, 255, ${clamp01(alpha)})`;
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha)})`;
    }
  }
  return color;
}
