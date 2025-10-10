import { bbox, polygonCentroid, pointInPoly } from '../utils/geometry.js';
import { poissonInPolygon } from '../utils/seeding.js';
import { Perlin } from '../utils/noise.js';

const TAU = Math.PI * 2;

export function runWatercolorWash({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const polygon = state.pts;
  if (!polygon || polygon.length < 3) return;

  const layerCount = clamp(Math.round(readNumber(controls.washLayers, 6)), 1, 24);
  const baseScale = Math.max(18, readNumber(controls.washScale, 160));
  const scaleJitter = clamp01(readNumber(controls.washScaleJitter, 0.55));
  const noiseScale = Math.max(24, readNumber(controls.washNoiseScale, 320));
  const threshold = clamp01(readNumber(controls.washThreshold, 0.35));
  const baseOpacity = clamp01(readNumber(controls.washOpacity, 0.24));
  const hueJitterDeg = Math.max(0, readNumber(controls.washHueJitter, 8));
  const satJitter = clamp(readNumber(controls.washSatJitter, 0.18), 0, 0.9);
  const lightJitter = clamp(readNumber(controls.washLightnessJitter, 0.16), 0, 0.45);
  const seed = (readNumber(controls.washSeed, 0) | 0);

  const baseColor = controls.color?.value || '#7ca5d4';
  const baseHsl = hexToHsl(baseColor);
  const shapeHash = hashPoints(polygon);
  const perlin = new Perlin((seed ^ (shapeHash * 0x45d9f3b)) >>> 0);

  const { minx, miny, maxx, maxy } = bbox(polygon);
  const areaApprox = Math.max(1, (maxx - minx) * (maxy - miny));
  const margin = Math.max(28, baseScale * 0.6);
  const centroid = polygonCentroid(polygon);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');

  // Base translucent wash to tint the interior before layering blobs
  helpers.tracePolygonPath();
  const baseRgb = hslToRgb(baseHsl.h, baseHsl.s, baseHsl.l);
  ctx.fillStyle = rgbaString(baseRgb, baseOpacity * 0.35);
  ctx.globalAlpha = 1;
  ctx.fill();

  const previousComposite = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';

  for (let i = 0; i < layerCount; i++) {
    const layerRng = createRng(shapeHash ^ seed ^ (i * 0x9e3779b9));
    const layerPhase = layerCount === 1 ? 0 : i / (layerCount - 1);
    const scaleFactor = lerp(1.25, 0.55, layerPhase);
    const jitterFactor = Math.max(0.35, 1 + (layerRng() - 0.5) * 2 * scaleJitter);
    const layerScale = Math.max(12, baseScale * scaleFactor * jitterFactor);
    const layerSpacing = Math.max(16, layerScale * 0.78);

    const densityTarget = clamp(areaApprox / (layerSpacing * layerSpacing), 12, 420);
    const samples = poissonInPolygon(layerSpacing, polygon, canvas.width, canvas.height, layerRng);
    if (!samples.length) continue;

    const hueOffset = (layerRng() - 0.5) * 2 * hueJitterDeg;
    const satOffset = (layerRng() - 0.5) * 2 * satJitter;
    const lightOffset = (layerRng() - 0.5) * 2 * lightJitter;

    const layerHue = wrapHue(baseHsl.h + hueOffset);
    const layerSat = clamp01(baseHsl.s * (1 + satOffset));
    const layerLight = clamp01(baseHsl.l + lightOffset);
    const layerRgb = hslToRgb(layerHue, layerSat, layerLight);

    const layerOpacity = clamp01(baseOpacity * lerp(0.32, 1, 1 - layerPhase * 0.75));
    const layerOffsetX = layerRng() * 2048;
    const layerOffsetY = layerRng() * 2048;
    const maxBlobs = Math.min(samples.length, Math.max(10, Math.round(densityTarget * 1.2)));
    let drawn = 0;
    const startIndex = (layerRng() * samples.length) | 0;

    for (let s = 0; s < samples.length && drawn < maxBlobs; s++) {
      const sample = samples[(startIndex + s) % samples.length];
      const drift = layerScale * 0.2 * (layerRng() - 0.5);
      let px = sample.x;
      let py = sample.y;
      if (Math.abs(drift) > 1e-3) {
        const dx = centroid.x - sample.x;
        const dy = centroid.y - sample.y;
        const len = Math.hypot(dx, dy) || 1;
        px = sample.x + (dx / len) * drift;
        py = sample.y + (dy / len) * drift;
        if (!pointInPoly(px, py, polygon)) {
          px = sample.x;
          py = sample.y;
        }
      }

      if (
        px < minx - margin ||
        px > maxx + margin ||
        py < miny - margin ||
        py > maxy + margin
      ) {
        continue;
      }

      const noiseValue = perlin.fbm2((px + layerOffsetX) / noiseScale, (py + layerOffsetY) / noiseScale, 4);
      const normalized = clamp01(0.5 + noiseValue * 0.5);
      if (normalized < threshold) continue;

      const strength = Math.pow((normalized - threshold) / Math.max(1e-3, 1 - threshold), 0.9);
      const radius = Math.max(8, layerScale * lerp(0.55, 1.85, strength));
      const coreAlpha = clamp01(layerOpacity * lerp(0.45, 1.1, strength));
      const edgeAlpha = layerOpacity * 0.08;

      drawBlob(ctx, px, py, radius, layerRgb, coreAlpha, edgeAlpha);
      drawn++;
    }
  }

  ctx.globalCompositeOperation = previousComposite;
  ctx.restore();
}

function drawBlob(ctx, x, y, radius, rgb, coreAlpha, edgeAlpha) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, rgbaString(rgb, coreAlpha));
  gradient.addColorStop(0.55, rgbaString(rgb, coreAlpha * 0.6));
  gradient.addColorStop(1, rgbaString(rgb, edgeAlpha));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}

function readNumber(input, fallback) {
  if (!input) return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
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

function createRng(seed) {
  let state = seed >>> 0;
  if (!state) state = 0x6d2b79f5;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state >>> 8) / 0x00ffffff;
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

function hexToHsl(hex) {
  if (!hex) return { h: 0, s: 0, l: 0.5 };
  let text = hex.trim();
  if (text[0] === '#') text = text.slice(1);
  if (text.length === 3) text = text.split('').map((c) => c + c).join('');
  if (text.length !== 6) return { h: 0, s: 0, l: 0.5 };
  const r = parseInt(text.slice(0, 2), 16) / 255;
  const g = parseInt(text.slice(2, 4), 16) / 255;
  const b = parseInt(text.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta > 1e-6) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r:
        h = (g - b) / delta + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / delta + 2;
        break;
      default:
        h = (r - g) / delta + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const light = clamp01(l);
  if (sat <= 1e-6) {
    const v = Math.round(light * 255);
    return { r: v, g: v, b: v };
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const hk = hue / 360;
  const r = hueToRgb(p, q, hk + 1 / 3);
  const g = hueToRgb(p, q, hk);
  const b = hueToRgb(p, q, hk - 1 / 3);
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function hueToRgb(p, q, t) {
  let temp = t;
  if (temp < 0) temp += 1;
  if (temp > 1) temp -= 1;
  if (temp < 1 / 6) return p + (q - p) * 6 * temp;
  if (temp < 1 / 2) return q;
  if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6;
  return p;
}

function wrapHue(h) {
  let result = h % 360;
  if (result < 0) result += 360;
  return result;
}

function rgbaString(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp01(alpha)})`;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
