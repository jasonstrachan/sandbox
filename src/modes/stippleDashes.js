import { poissonInPolygon } from '../utils/seeding.js';
import { Perlin } from '../utils/noise.js';
import { pointInPoly, smoothstep, nearestEdgeInfo } from '../utils/geometry.js';

const TAU = Math.PI * 2;

export function runStippleDashes({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const spacing = Math.max(2, readNumber(controls.stippleDashesSpacing, 22));
  const baseLength = Math.max(0.5, readNumber(controls.stippleDashesLength, 7));
  const lengthJitter = clamp01(readNumber(controls.stippleDashesLengthJitter, 0.35));
  const baseWeight = Math.max(0.1, readNumber(controls.stippleDashesWeight, 2.8));
  const weightJitter = clamp01(readNumber(controls.stippleDashesWeightJitter, 0.25));
  const scatter = Math.max(0, readNumber(controls.stippleDashesScatter, 0));
  const angleBase = (readNumber(controls.stippleDashesAngle, 0) * Math.PI) / 180;
  const angleDrift = Math.max(0, readNumber(controls.stippleDashesAngleDrift, 0)) * Math.PI / 180;
  const angleScale = Math.max(1, readNumber(controls.stippleDashesAngleScale, 420));
  const seed = (readNumber(controls.stippleDashesSeed, 0) | 0);
  const strokeWidth = Math.max(0.1, readNumber(controls.strokeLW, 1.5));
  const color = controls.color?.value || '#ffffff';

  const rng = createRng(seed);
  const angleNoise = angleDrift > 1e-6 ? new Perlin(seed ^ 0x3f11c2d9) : null;

  const nearScale = sanitizeScale(controls.stippleDashesFalloffNear, 1, 0.15, 4);
  const farScale = sanitizeScale(controls.stippleDashesFalloffFar, 1, 0.15, 5);
  const baseAlignNear = Math.max(8, spacing * 2.8);
  const alignReachNear = baseAlignNear * nearScale;
  const baseAlignFar = Math.max(alignReachNear * 2.4, spacing * 6, baseLength * 5, 36);
  const alignReachFar = baseAlignFar * farScale;
  const nearStrength = clamp(0.35 + nearScale * 0.55, 0.1, 1.2);
  const farWeight = clamp(0.25 + farScale * 0.25, 0.05, 0.9);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = color;

  const samples = poissonInPolygon(spacing, state.pts, canvas.width, canvas.height, rng);
  if (!samples.length) {
    ctx.restore();
    return;
  }

  const lengthScale = Math.max(0.5, strokeWidth * 0.75);
  const weightScale = Math.max(0.2, strokeWidth * 0.6);

  for (const sample of samples) {
    const p = jitterPoint(sample, scatter, state.pts, rng);
    let theta = angleBase;
    if (angleNoise) {
      const n = angleNoise.fbm2(p.x / angleScale, p.y / angleScale, 3);
      theta += clamp(n, -1, 1) * angleDrift;
    }
    const edgeInfo = nearestEdgeInfo(p.x, p.y, state.pts);
    if (edgeInfo) {
      const dist = Math.abs(edgeInfo.distance);
      const nearFall = 1 - smoothstep(0, alignReachNear, dist);
      const farFall = 1 - smoothstep(0, alignReachFar, dist);
      const combined = Math.max(nearFall, farFall * farWeight);
      const align = nearStrength * Math.pow(combined, 0.92);
      if (align > 1e-3) {
        const baseDirX = Math.cos(theta);
        const baseDirY = Math.sin(theta);
        let tx = edgeInfo.tx;
        let ty = edgeInfo.ty;
        if (tx * baseDirX + ty * baseDirY < 0) {
          tx = -tx;
          ty = -ty;
        }
        const blendX = baseDirX * (1 - align) + tx * align;
        const blendY = baseDirY * (1 - align) + ty * align;
        const mag = Math.hypot(blendX, blendY);
        if (mag > 1e-6) {
          const nx = blendX / mag;
          const ny = blendY / mag;
          theta = Math.atan2(ny, nx);
        }
      }
    }
    const length = Math.max(0.5, baseLength * lengthScale * (1 + (rng() - 0.5) * 2 * lengthJitter));
    const width = Math.max(0.2, baseWeight * weightScale * (1 + (rng() - 0.5) * 2 * weightJitter));
    const alpha = clamp(0.85 + (rng() - 0.5) * 0.4, 0.35, 1);

    const half = length * 0.5;
    const dx = Math.cos(theta) * half;
    const dy = Math.sin(theta) * half;

    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(p.x - dx, p.y - dy);
    ctx.lineTo(p.x + dx, p.y + dy);
    ctx.stroke();

    const capScale = 0.68 + (rng() - 0.5) * 0.24;
    const capRadius = Math.max(width * 0.6, width * capScale);
    const startX = p.x - dx;
    const startY = p.y - dy;
    const endX = p.x + dx;
    const endY = p.y + dy;

    ctx.beginPath();
    ctx.arc(startX, startY, capRadius, 0, TAU);
    ctx.arc(endX, endY, capRadius, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

function readNumber(input, fallback) {
  if (!input) return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function jitterPoint(point, scatter, polygon, rng) {
  if (!scatter) return point;
  const ang = rng() * TAU;
  const dist = scatter * (Math.pow(rng(), 0.85) - 0.5) * 2;
  const nx = point.x + Math.cos(ang) * dist;
  const ny = point.y + Math.sin(ang) * dist;
  if (pointInPoly(nx, ny, polygon)) return { x: nx, y: ny };
  return point;
}

function sanitizeScale(input, fallback, min, max) {
  const value = readNumber(input, fallback);
  return clamp(value, min, max);
}

function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s >>> 8) / 0x00ffffff;
  };
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
