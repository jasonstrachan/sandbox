import { buildSDF, bilinearScalar, march } from '../utils/fields.js';

export function runIsolineGlow({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;

  helpers.prepareRender();

  const spacing = readNumber(controls.isoGlowSpacing?.value, 32, 6);
  const sampleStep = readNumber(controls.isoGlowStep?.value, 8, 2);
  const feather = readNumber(controls.isoGlowFeather?.value, 12, 1);
  const highlightStrength = clamp01(readNumber(controls.isoGlowGlowAlpha?.value, 0.85, 0, 1));
  const bandFill = clamp01(readNumber(controls.isoGlowBandAlpha?.value, 0.22, 0, 1));
  const maxDistanceLimit = readNumber(
    controls.isoGlowMaxDist?.value,
    Math.max(420, spacing * 6),
    spacing * 1.5,
  );

  const grid = buildSDF(sampleStep, state.pts, canvas.width, canvas.height);
  const sampleField = bilinearScalar(grid.minx, grid.miny, grid.step, grid.nx, grid.ny, grid.field);

  let maxInsideDistance = 0;
  for (const value of grid.field) if (value > maxInsideDistance) maxInsideDistance = value;
  const maxDistance = Math.min(maxInsideDistance, maxDistanceLimit);
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) return;

  const minX = Math.max(0, Math.floor(grid.minx));
  const minY = Math.max(0, Math.floor(grid.miny));
  const maxX = Math.min(canvas.width, Math.ceil(grid.maxx));
  const maxY = Math.min(canvas.height, Math.ceil(grid.maxy));
  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  if (!width || !height) return;

  const baseColor = hexToRgb(controls.color?.value) || { r: 230, g: 235, b: 255 };
  const highlightColor = mixWithWhite(baseColor, 0.72);

  const evenBandMix = 0.48;
  const oddBandMix = 0.26;

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    const sampleY = minY + y + 0.5;
    for (let x = 0; x < width; x++) {
      const sampleX = minX + x + 0.5;
      const distance = sampleField(sampleX, sampleY);
      if (!Number.isFinite(distance) || distance <= 0) continue;

      const normalized = Math.min(distance / maxDistance, 1);
      if (normalized >= 0.999) continue;

      const bandIndex = Math.max(0, Math.floor(distance / spacing));
      const bandPhase = distance / spacing - bandIndex;
      const distanceToIso = Math.min(bandPhase, 1 - bandPhase) * spacing;
      const glow = gaussianFalloff(distanceToIso, feather) * highlightStrength;

      const fade = 1 - normalized;
      const bandAlpha = bandFill * fade * (bandIndex % 2 === 0 ? 1 : 0.65);
      const rawAlpha = bandAlpha + glow;
      if (rawAlpha <= 1e-4) continue;

      const totalAlpha = Math.min(1, rawAlpha);
      const scale = rawAlpha > 1 ? totalAlpha / rawAlpha : 1;

      const bandMixBase = bandIndex % 2 === 0 ? evenBandMix : oddBandMix;
      const bandMix = clamp01(bandMixBase + fade * 0.35);
      const bandColor = mixWithWhite(baseColor, bandMix);

      const scaledBandAlpha = bandAlpha * scale;
      const scaledGlow = glow * scale;

      const premultR = bandColor.r * scaledBandAlpha + highlightColor.r * scaledGlow;
      const premultG = bandColor.g * scaledBandAlpha + highlightColor.g * scaledGlow;
      const premultB = bandColor.b * scaledBandAlpha + highlightColor.b * scaledGlow;

      const offset = (y * width + x) * 4;
      data[offset + 3] = Math.round(totalAlpha * 255);
      if (totalAlpha > 1e-5) {
        const invAlpha = 1 / totalAlpha;
        data[offset] = Math.max(0, Math.min(255, Math.round(premultR * invAlpha)));
        data[offset + 1] = Math.max(0, Math.min(255, Math.round(premultG * invAlpha)));
        data[offset + 2] = Math.max(0, Math.min(255, Math.round(premultB * invAlpha)));
      } else {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      }
    }
  }

  ctx.putImageData(imageData, minX, minY);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = rgbToRgba(highlightColor, Math.min(0.9, highlightStrength + 0.2));
  ctx.shadowBlur = Math.max(2, feather * 0.85);
  ctx.strokeStyle = rgbToHex(highlightColor);
  ctx.lineWidth = Math.max(1.2, spacing * 0.08);
  const maxIso = Math.min(maxDistance, maxDistanceLimit);
  for (let level = 0; level <= maxIso; level += spacing) {
    const opacity = clamp01(0.18 + (1 - level / maxIso) * 0.65);
    ctx.globalAlpha = opacity;
    march(grid.minx, grid.miny, grid.step, grid.nx, grid.ny, grid.field, level, (a, b) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
  }
  ctx.restore();
}

function gaussianFalloff(distance, sigma) {
  if (!Number.isFinite(distance) || !Number.isFinite(sigma) || sigma <= 0) return 0;
  const d = distance / sigma;
  return Math.exp(-0.5 * d * d);
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let text = hex.trim();
  if (!text) return null;
  if (text[0] === '#') text = text.slice(1);
  if (text.length === 3) {
    text = text
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (text.length !== 6) return null;
  const r = Number.parseInt(text.slice(0, 2), 16);
  const g = Number.parseInt(text.slice(2, 4), 16);
  const b = Number.parseInt(text.slice(4, 6), 16);
  if ([r, g, b].some((component) => Number.isNaN(component))) return null;
  return { r, g, b };
}

function mixWithWhite(rgb, factor) {
  if (!rgb) return { r: 240, g: 240, b: 255 };
  const f = clamp01(factor);
  return {
    r: Math.round(rgb.r + (255 - rgb.r) * f),
    g: Math.round(rgb.g + (255 - rgb.g) * f),
    b: Math.round(rgb.b + (255 - rgb.b) * f),
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = (value) => {
    const v = Math.max(0, Math.min(255, Math.round(value)));
    return v.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToRgba({ r, g, b }, alpha = 1) {
  const a = clamp01(alpha);
  return `rgba(${Math.round(clampComponent(r))}, ${Math.round(clampComponent(g))}, ${Math.round(
    clampComponent(b),
  )}, ${a})`;
}

function clampComponent(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function readNumber(value, fallback, min = -Infinity, max = Infinity) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const clamped = Math.max(min, Math.min(max, num));
  if (!Number.isFinite(clamped)) return fallback;
  return clamped;
}
