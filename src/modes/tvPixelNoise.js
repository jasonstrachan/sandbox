import { bbox } from '../utils/geometry.js';

const MAX_CELLS = 180000;

export function runTvPixelNoise({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const polygon = state.pts;
  if (!polygon || polygon.length < 3) return;

  let pixelSize = clampInt(readNumber(controls.tvPixelSize, 6), 1, 120);
  const jitter = clamp01(readNumber(controls.tvPixelJitter, 0.3));
  const contrast = clamp(readNumber(controls.tvNoiseContrast, 1), 0.1, 3);
  const colorBleed = clamp01(readNumber(controls.tvColorBleed, 0.35));
  const scanlineStrength = clamp01(readNumber(controls.tvScanlineStrength, 0.15));
  const seedOffset = readSeed(controls.tvNoiseSeed);
  const seed = hashPoints(polygon) ^ seedOffset;
  const rng = createRng(seed);

  const { minx, miny, maxx, maxy } = bbox(polygon);
  const pad = pixelSize * 2;
  const startX = Math.max(0, Math.floor(minx - pad));
  const startY = Math.max(0, Math.floor(miny - pad));
  const endX = Math.min(canvas.width, Math.ceil(maxx + pad));
  const endY = Math.min(canvas.height, Math.ceil(maxy + pad));

  const width = Math.max(1, endX - startX);
  const height = Math.max(1, endY - startY);
  const estimatedCols = Math.max(1, Math.ceil(width / pixelSize));
  const estimatedRows = Math.max(1, Math.ceil(height / pixelSize));
  const estimatedCells = estimatedCols * estimatedRows;
  if (estimatedCells > MAX_CELLS) {
    const scale = Math.sqrt(estimatedCells / MAX_CELLS);
    pixelSize = Math.max(2, Math.round(pixelSize * scale));
  }

  const baseColor = hexToRgb(controls.color?.value || '#ffffff');
  const bgColor = hexToRgb(controls.bg?.value || '#000000');

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');

  const luminanceScale = 0.23 * contrast;
  const jitterScale = 0.25 * jitter;
  const hotPixelChance = 0.0005 * contrast;
  const coldPixelChance = 0.00035 * contrast;

  let rowIndex = 0;
  for (let y = startY; y < endY; y += pixelSize, rowIndex++) {
    const scanlineMask = 1 - scanlineStrength * (0.5 + 0.5 * Math.sin((rowIndex + seed * 0.00037) * 0.9));

    for (let x = startX; x < endX; x += pixelSize) {
      const baseNoise = clamp01(
        0.5 + gaussianNoise(rng) * luminanceScale + (rng() - 0.5) * jitterScale,
      );

      let rSample = clamp01(baseNoise + (rng() - 0.5) * colorBleed * 0.9);
      let gSample = clamp01(baseNoise + (rng() - 0.5) * colorBleed * 0.6);
      let bSample = clamp01(baseNoise + (rng() - 0.5) * colorBleed * 1.1);

      const flicker = 1 + (rng() - 0.5) * 0.06 * contrast;
      rSample = clamp01(rSample * flicker);
      gSample = clamp01(gSample * flicker);
      bSample = clamp01(bSample * flicker);

      if (rng() < hotPixelChance) {
        rSample = clamp01(rSample + 0.6 + rng() * 0.4);
        gSample = clamp01(gSample + 0.2 + rng() * 0.3);
        bSample = clamp01(bSample + 0.1 + rng() * 0.2);
      } else if (rng() < coldPixelChance) {
        rSample *= rng() * 0.4;
        gSample *= rng() * 0.3;
        bSample *= rng() * 0.3;
      }

      const r = lerp(bgColor.r, baseColor.r, rSample * scanlineMask);
      const g = lerp(bgColor.g, baseColor.g, gSample * scanlineMask);
      const b = lerp(bgColor.b, baseColor.b, bSample * scanlineMask);

      ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
      ctx.fillRect(x, y, pixelSize, pixelSize);
    }
  }

  ctx.restore();
}

function readNumber(input, fallback) {
  if (!input || typeof input.value === 'undefined') return fallback;
  const parsed = Number(input.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readSeed(input) {
  if (!input || typeof input.value === 'undefined') return 0;
  const value = input.value;
  if (value === '') return 0;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed | 0;
  return hashString(String(value));
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
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

function clampInt(value, min, max) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return min;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function gaussianNoise(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
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

function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state >>> 8) / 0x00ffffff;
  };
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return { r: 255, g: 255, b: 255 };
  const normalized = hex.replace(/[^0-9a-fA-F]/g, '');
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return { r, g, b };
  }
  if (normalized.length !== 6) return { r: 255, g: 255, b: 255 };
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { r, g, b };
}
