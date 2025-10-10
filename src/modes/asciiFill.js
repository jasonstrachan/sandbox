import { pointInPoly, bbox, polygonCentroid } from '../utils/geometry.js';

const DEFAULT_SPAM_LINES = [
  'CONGRATULATIONS WINNER! CLICK TO CLAIM YOUR PRIZE $$$',
  'LIMITED-TIME OFFER: APPROVED CREDIT BOOST TODAY ONLY',
  'URGENT ACCOUNT NOTICE - VERIFY YOUR DETAILS NOW',
  'YOU HAVE UNSENT FUNDS WAITING - ACT BEFORE MIDNIGHT',
  'FREE VACATION VOUCHER ENCLOSED! PAY JUST SHIPPING',
];

const MONO_FONT_STACK = '"Fira Code", "SFMono-Regular", "Segoe UI Mono", Menlo, Consolas, monospace';
const MAX_CELLS = 80000;

export function runAsciiFill({ ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const polygon = state.pts;
  if (!polygon || polygon.length < 3) return;

  const strokeColor = controls.color?.value || '#ffffff';
  const fontSize = clamp(readNumber(controls.asciiFontSize, 18), 6, 120);
  const spacingMultiplier = clamp(readNumber(controls.asciiSpacing, 1.35), 0.5, 4);
  const jitterAmount = clamp01(readNumber(controls.asciiJitter, 0));
  const baseAngle = toRadians(readNumber(controls.asciiAngle, 0));
  const spamLines = getSpamLines(controls.asciiCharset?.value);
  if (!spamLines.length) return;

  let charStep = Math.max(2, fontSize * spacingMultiplier * 0.6);
  let lineStep = Math.max(2, fontSize * spacingMultiplier);
  const { minx, miny, maxx, maxy } = bbox(polygon);
  const width = Math.max(4, maxx - minx);
  const height = Math.max(4, maxy - miny);
  const estimatedCols = Math.max(1, Math.ceil(width / charStep));
  const estimatedRows = Math.max(1, Math.ceil(height / lineStep));
  const estimatedCells = estimatedCols * estimatedRows;
  if (estimatedCells > MAX_CELLS) {
    const scale = Math.sqrt(estimatedCells / MAX_CELLS);
    charStep *= scale;
    lineStep *= scale;
  }
  const pad = Math.max(charStep, lineStep);

  const fontSpec = `400 ${fontSize}px ${MONO_FONT_STACK}`;
  const glyphColor = strokeColor;

  const seed = hashPoints(polygon) ^ 0x45d12fb1;
  const rng = createRng(seed);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.fillStyle = glyphColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = fontSpec;

  const centroid = polygonCentroid(polygon);
  const cosA = Math.cos(baseAngle);
  const sinA = Math.sin(baseAngle);

  const totalRows = Math.ceil((maxy - miny + pad * 2) / lineStep) + 2;
  const totalCols = Math.ceil((maxx - minx + pad * 2) / charStep) + 2;

  for (let row = 0; row < totalRows; row++) {
    const lineText = spamLines[row % spamLines.length];
    if (!lineText) continue;
    for (let col = 0; col < totalCols; col++) {
      const char = lineText[col % lineText.length] || ' ';
      if (char === ' ' && jitterAmount <= 0) continue;

      const rawX = minx - pad + col * charStep + charStep * 0.5;
      const rawY = miny - pad + row * lineStep + lineStep * 0.5;
      const jitterX = (rng() - 0.5) * charStep * 0.4 * jitterAmount;
      const jitterY = (rng() - 0.5) * lineStep * 0.35 * jitterAmount;
      const shiftedX = rawX + jitterX;
      const shiftedY = rawY + jitterY;
      const rotated = rotateAround(shiftedX, shiftedY, centroid, cosA, sinA);

      if (!pointInPoly(rotated.x, rotated.y, polygon)) continue;

      if (char === ' ') continue;

      ctx.save();
      ctx.translate(rotated.x, rotated.y);
      if (Math.abs(baseAngle) > 1e-3) ctx.rotate(baseAngle);
      ctx.fillText(char, 0, 0);
      ctx.restore();
    }
  }

  ctx.restore();
}

function getSpamLines(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return DEFAULT_SPAM_LINES;
  const parts = rawValue
    .split(/\|/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!parts.length) return DEFAULT_SPAM_LINES;
  return parts;
}

function readNumber(input, fallback) {
  if (!input || typeof input.value === 'undefined') return fallback;
  const parsed = Number(input.value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function rotateAround(x, y, origin, cosA, sinA) {
  const dx = x - origin.x;
  const dy = y - origin.y;
  return {
    x: origin.x + dx * cosA - dy * sinA,
    y: origin.y + dx * sinA + dy * cosA,
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
  if (!state) state = 0x6d2b79f5;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state >>> 8) / 0x00ffffff;
  };
}
