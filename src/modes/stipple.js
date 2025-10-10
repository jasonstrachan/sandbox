import { poissonInPolygon } from '../utils/seeding.js';
import { Perlin } from '../utils/noise.js';
import { pointInPoly, smoothstep, nearestEdgeInfo } from '../utils/geometry.js';

const TAU = Math.PI * 2;

export function runStippleDots({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const spacing = Math.max(2, readNumber(controls.stippleDotsSpacing, 18));
  const baseSize = Math.max(0.1, readNumber(controls.stippleDotsSize, 2.2));
  const sizeJitter = clamp01(readNumber(controls.stippleDotsSizeJitter, 0.35));
  const scatter = Math.max(0, readNumber(controls.stippleDotsScatter, 2.2));
  const noiseScale = Math.max(1, readNumber(controls.stippleDotsNoiseScale, 140));
  const noiseStrength = clamp01(readNumber(controls.stippleDotsNoiseStrength, 0.65));
  const seed = (readNumber(controls.stippleDotsSeed, 0) | 0);
  const strokeWidth = Math.max(0.1, readNumber(controls.strokeLW, 1.5));
  const color = controls.color?.value || '#ffffff';

  const rng = createRng(seed);
  const noise = noiseStrength > 1e-3 ? new Perlin(seed ^ 0x6c1b5a3d) : null;

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.fillStyle = color;

  const samples = poissonInPolygon(spacing, state.pts, canvas.width, canvas.height, rng);
  if (!samples.length) {
    ctx.restore();
    return;
  }

  const sizeScale = Math.max(0.35, strokeWidth * 0.6);

  for (const sample of samples) {
    const p = jitterPoint(sample, scatter, state.pts, rng);

    const baseRadius = Math.max(0.2, baseSize * sizeScale);
    const jitterOffset = sizeJitter > 1e-6 ? (rng() - 0.5) * 2 * sizeJitter : 0;
    let radius = baseRadius * (1 + jitterOffset);
    radius = Math.max(0.2, radius);

    let alpha = clamp(1 - sizeJitter * 0.3 + (rng() - 0.5) * sizeJitter * 0.6, 0.25, 1.05);
    if (noise) {
      const noiseValue = noise.fbm2(p.x / noiseScale, p.y / noiseScale, 4);
      const noiseNorm = (noiseValue * 0.5) + 0.5;
      alpha *= lerp(1, lerp(0.75, 1.15, noiseNorm), noiseStrength);
    }

    ctx.globalAlpha = clamp(alpha, 0.2, 1);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

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

  const nearScale = sanitizeScale(controls.stippleDashesFalloffNear?.value, 1, 0.15, 4);
  const farScale = sanitizeScale(controls.stippleDashesFalloffFar?.value, 1, 0.15, 5);
  const baseAlignNear = Math.max(8, spacing * 2.8);
  const alignReachNear = baseAlignNear * nearScale;
  const baseAlignFar = Math.max(alignReachNear * 2.4, spacing * 6, baseLength * 5, 36);
  const alignReachFar = baseAlignFar * farScale;
  const edgeAlignStrength = 1;

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
      const align = edgeAlignStrength * Math.pow(Math.max(nearFall, farFall * 0.68), 0.92);
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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sanitizeScale(raw, fallback, min, max) {
  const val = Number(raw);
  if (!Number.isFinite(val)) return fallback;
  return Math.min(max, Math.max(min, val));
}
