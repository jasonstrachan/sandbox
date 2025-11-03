import { poissonInPolygon } from '../utils/seeding.js';
import { Perlin } from '../utils/noise.js';
import { pointInPoly } from '../utils/geometry.js';

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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
