import { buildSDF, gradientField, bilinearGrad, bilinearScalar } from '../utils/fields.js';
import { pointInPoly } from '../utils/geometry.js';
import { poissonInPolygon } from '../utils/seeding.js';
import { Perlin } from '../utils/noise.js';

export function runInkRibbons({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;

  helpers.prepareRender();

  const color = controls.color?.value || '#0d1d71';
  const sdfStep = Math.max(4, readNumber(controls.cStep, 8));
  const seedSpacing = Math.max(6, readNumber(controls.ribbonSpacing, 26));
  const stepSize = Math.max(0.4, readNumber(controls.ribbonStep, 3));
  const maxSteps = clampInt(readNumber(controls.ribbonMax, 620), 8, 6000);
  const tangentWeight = clamp01(readNumber(controls.ribbonTangent, 0.78));
  const biasAngle = toRadians(readNumber(controls.ribbonBiasAngle, 92));
  const noiseStrength = clamp01(readNumber(controls.ribbonNoiseStrength, 0.18));
  const noiseScale = Math.max(10, readNumber(controls.ribbonNoiseScale, 220));
  const noiseOctaves = clampInt(readNumber(controls.ribbonNoiseOctaves, 3), 1, 6);
  const lineWidth = Math.max(0.6, readNumber(controls.ribbonLineWidth, 1.55));
  const jitter = clamp01(readNumber(controls.ribbonJitter, 0.25));
  const anchorFalloff = clamp01(readNumber(controls.ribbonAnchor, 0.28));
  const seedValue = Math.round(readNumber(controls.ribbonSeed, 2025));

  const grid = buildSDF(sdfStep, state.pts, canvas.width, canvas.height);
  const { gx, gy } = gradientField(grid.nx, grid.ny, grid.step, grid.field);
  const grad = bilinearGrad(grid.minx, grid.miny, grid.step, grid.nx, grid.ny, gx, gy);
  const sampleDistance = bilinearScalar(grid.minx, grid.miny, grid.step, grid.nx, grid.ny, grid.field);

  const bias = { x: Math.cos(biasAngle), y: Math.sin(biasAngle) };
  const perlin = new Perlin(seedValue >>> 0);
  const noise = (x, y) => perlin.fbm2(x, y, noiseOctaves);
  const rng = createRng((seedValue ^ 0x9e3779b9) >>> 0);

  const seeds = poissonInPolygon(seedSpacing, state.pts, canvas.width, canvas.height, rng);
  if (!seeds.length) return;

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;

  const drawnAnchors = [];
  const rejectDist = seedSpacing * 0.45;

  for (const seed of seeds) {
    if (!pointInPoly(seed.x, seed.y, state.pts)) continue;
    if (isNearAnchors(seed)) continue;

    const jittered = {
      x: seed.x + (rng() - 0.5) * seedSpacing * jitter,
      y: seed.y + (rng() - 0.5) * seedSpacing * jitter,
    };

    const forward = integrate(jittered, +1);
    const backward = integrate(jittered, -1).reverse();
    const path = backward.concat([jittered], forward);

    if (path.length < 6) continue;

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();

    drawnAnchors.push(jittered);
  }

  ctx.restore();

  function integrate(start, direction) {
    const pts = [];
    let x = start.x;
    let y = start.y;
    for (let i = 0; i < maxSteps; i++) {
      if (!pointInPoly(x, y, state.pts)) break;
      const g = grad(x, y);
      let tx = -g.gy;
      let ty = g.gx;
      if (!Number.isFinite(tx) || !Number.isFinite(ty) || (Math.abs(tx) < 1e-4 && Math.abs(ty) < 1e-4)) {
        tx = bias.x;
        ty = bias.y;
      }

      if (tx * bias.x + ty * bias.y < 0) {
        tx = -tx;
        ty = -ty;
      }

      let vx = tx * tangentWeight + bias.x * (1 - tangentWeight);
      let vy = ty * tangentWeight + bias.y * (1 - tangentWeight);

      if (noiseStrength > 0.0001) {
        const theta = (noise(x / noiseScale, y / noiseScale) * 2 - 1) * noiseStrength * Math.PI * 0.35;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const rx = vx * cosT - vy * sinT;
        const ry = vx * sinT + vy * cosT;
        vx = rx;
        vy = ry;
      }

      const len = Math.hypot(vx, vy) || 1;
      vx /= len;
      vy /= len;

      const step = adjustStep(x, y, direction);

      x += direction * vx * step;
      y += direction * vy * step;

      if (!pointInPoly(x, y, state.pts)) break;
      pts.push({ x, y });
    }
    return pts;
  }

  function adjustStep(x, y, direction) {
    if (anchorFalloff <= 0.001) return stepSize;
    const distance = Math.max(0, sampleDistance(x, y));
    const factor = 1 - Math.max(0, Math.min(1, distance / (seedSpacing * 1.2)));
    const eased = anchorFalloff * factor + (1 - anchorFalloff);
    return stepSize * eased;
  }

  function isNearAnchors(pt) {
    for (const existing of drawnAnchors) {
      if (Math.hypot(existing.x - pt.x, existing.y - pt.y) < rejectDist) return true;
    }
    return false;
  }
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

function toRadians(deg) {
  return (deg || 0) * Math.PI / 180;
}

function createRng(seed) {
  let state = seed >>> 0;
  if (!state) state = 0x6d2b79f5;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state >>> 8) / 0x00ffffff;
  };
}
