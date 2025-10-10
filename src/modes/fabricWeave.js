import { bbox, polygonCentroid } from '../utils/geometry.js';
import { Perlin } from '../utils/noise.js';

export function runFabricWeave({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const polygon = state.pts;
  if (!polygon || polygon.length < 3) return;

  const angle = toRadians(readNumber(controls.weaveAngle, 12));
  const spacing = Math.max(6, readNumber(controls.weaveSpacing, 48));
  const baseWidth = Math.max(4, readNumber(controls.weaveWidth, 26));
  const modStrength = clamp01(readNumber(controls.weaveMod, 0.35));
  const noiseScale = Math.max(24, readNumber(controls.weaveNoiseScale, 320));
  const noiseOctaves = clamp(Math.round(readNumber(controls.weaveOctaves, 3)), 1, 6);
  const offsetRatio = clamp01(readNumber(controls.weaveOffset, 0.35));
  const contrast = clamp(readNumber(controls.weaveContrast, 0.32), 0, 0.8);
  const seed = (readNumber(controls.weaveSeed, 0) | 0);

  const baseColor = controls.color?.value || '#c7c9d9';
  const accentColor = controls.weaveAccentColor?.value || '#d49c5b';

  const shapeHash = hashPoints(polygon);
  const perlin = new Perlin((seed ^ (shapeHash * 0x27d4eb2d)) >>> 0);

  const { minx, miny, maxx, maxy } = bbox(polygon);
  const centroid = polygonCentroid(polygon);
  const diag = Math.hypot(maxx - minx, maxy - miny) || 1;
  const span = diag * 1.45 + spacing * 6;
  const offsetShift = (offsetRatio - 0.5) * spacing;

  const basePalette = buildPalette(baseColor, contrast);
  const accentPalette = buildPalette(accentColor, contrast * 0.9 + 0.04);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.imageSmoothingEnabled = true;

  drawRibbonSet(ctx, angle, basePalette, perlin, {
    spacing,
    baseWidth,
    modStrength,
    noiseScale,
    noiseOctaves,
    span,
    offset: offsetShift,
    centroid,
    polygon,
  });

  ctx.globalAlpha = 0.92;
  drawRibbonSet(ctx, angle + Math.PI / 2, accentPalette, perlin, {
    spacing,
    baseWidth,
    modStrength,
    noiseScale: noiseScale * 1.1,
    noiseOctaves: Math.max(2, noiseOctaves - 1),
    span,
    offset: -offsetShift,
    centroid,
    polygon,
  });
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawRibbonSet(ctx, theta, palette, perlin, params) {
  const {
    spacing,
    baseWidth,
    modStrength,
    noiseScale,
    noiseOctaves,
    span,
    offset,
    centroid,
    polygon,
  } = params;

  const dir = { x: Math.cos(theta), y: Math.sin(theta) };
  const normal = { x: -dir.y, y: dir.x };

  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const pt of polygon) {
    const proj = pt.x * normal.x + pt.y * normal.y;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }

  const margin = baseWidth * 4 + spacing * 3;
  minProj -= margin;
  maxProj += margin;

  const start = Math.floor((minProj + offset) / spacing) * spacing;
  const end = Math.ceil((maxProj + offset) / spacing) * spacing;

  let stripeIndex = 0;
  for (let proj = start; proj <= end; proj += spacing, stripeIndex++) {
    const centerOffset = proj + offset;
    const baseX = normal.x * centerOffset;
    const baseY = normal.y * centerOffset;
    const sampleX = (centroid.x + baseX) / noiseScale;
    const sampleY = (centroid.y + baseY) / noiseScale;
    const noiseValue = perlin.fbm2(sampleX, sampleY, noiseOctaves);
    const mod = clamp(noiseValue, -1, 1) * modStrength;
    const width = Math.max(3, baseWidth * (1 + mod));
    const halfWidth = width * 0.5;

    const center = {
      x: centroid.x + baseX,
      y: centroid.y + baseY,
    };

    const startPoint = {
      x: center.x - dir.x * span,
      y: center.y - dir.y * span,
    };
    const endPoint = {
      x: center.x + dir.x * span,
      y: center.y + dir.y * span,
    };

    const stripe = palette[stripeIndex % palette.length];
    const gradient = ctx.createLinearGradient(
      center.x - normal.x * halfWidth,
      center.y - normal.y * halfWidth,
      center.x + normal.x * halfWidth,
      center.y + normal.y * halfWidth,
    );
    gradient.addColorStop(0, rgbaString(stripe.shadow, 1));
    gradient.addColorStop(0.48, rgbaString(stripe.main, 1));
    gradient.addColorStop(0.52, rgbaString(stripe.highlight, 1));
    gradient.addColorStop(1, rgbaString(stripe.shadow, 1));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(startPoint.x - normal.x * halfWidth, startPoint.y - normal.y * halfWidth);
    ctx.lineTo(endPoint.x - normal.x * halfWidth, endPoint.y - normal.y * halfWidth);
    ctx.lineTo(endPoint.x + normal.x * halfWidth, endPoint.y + normal.y * halfWidth);
    ctx.lineTo(startPoint.x + normal.x * halfWidth, startPoint.y + normal.y * halfWidth);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = rgbaString(stripe.weft, 0.45);
    ctx.lineWidth = Math.max(0.75, width * 0.08);
    ctx.beginPath();
    ctx.moveTo(startPoint.x, startPoint.y);
    ctx.lineTo(endPoint.x, endPoint.y);
    ctx.stroke();

    ctx.strokeStyle = rgbaString(stripe.highlight, 0.22);
    ctx.lineWidth = Math.max(0.5, width * 0.045);
    ctx.beginPath();
    ctx.moveTo(startPoint.x + normal.x * (halfWidth * 0.65), startPoint.y + normal.y * (halfWidth * 0.65));
    ctx.lineTo(endPoint.x + normal.x * (halfWidth * 0.65), endPoint.y + normal.y * (halfWidth * 0.65));
    ctx.stroke();
  }
}

function buildPalette(hex, contrast) {
  const base = hexToHsl(hex);
  const alt = {
    h: wrapHue(base.h + 6),
    s: clamp01(base.s * (1 + contrast * 0.4)),
    l: clamp01(base.l * (1 - contrast * 0.35) + 0.08),
  };

  const main1 = adjustLightness(base, contrast * 0.35);
  const main2 = adjustLightness(alt, -contrast * 0.2);

  return [
    createStripeVariant(main1, contrast),
    createStripeVariant(main2, contrast * 0.85 + 0.04),
  ];
}

function createStripeVariant(hsl, contrast) {
  const main = hslToRgb(hsl.h, hsl.s, hsl.l);
  const highlight = hslToRgb(hsl.h, clamp01(hsl.s * (1 - contrast * 0.25)), clamp01(hsl.l + contrast * 0.28));
  const shadow = hslToRgb(hsl.h, clamp01(hsl.s * (1 + contrast * 0.45)), clamp01(hsl.l - contrast * 0.3));
  const weft = hslToRgb(hsl.h, clamp01(hsl.s * (1 - contrast * 0.2)), clamp01(hsl.l - contrast * 0.12));
  return { main, highlight, shadow, weft };
}

function adjustLightness(hsl, delta) {
  return {
    h: hsl.h,
    s: clamp01(hsl.s * (1 + delta * 0.25)),
    l: clamp01(hsl.l + delta),
  };
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

function toRadians(deg) {
  return (deg || 0) * Math.PI / 180;
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
