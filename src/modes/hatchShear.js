import { bbox } from '../utils/geometry.js';

export function runHatchShear({ ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const settings = readHatchShearSettings(controls);
  const bounds = bbox(state.pts);
  const pad = Math.max(settings.spacing * 2, settings.offset * 2, 12);
  const context = {
    minX: bounds.minx - pad,
    maxX: bounds.maxx + pad,
    minY: bounds.miny - pad,
    maxY: bounds.maxy + pad,
  };
  context.width = Math.max(1, context.maxX - context.minX);
  context.height = Math.max(1, context.maxY - context.minY);

  const baseSeed = hashPoints(state.pts);
  const spacingRngX = settings.spacingJitter > 0 ? createRng(baseSeed ^ 0x37a4b4c9) : null;
  const profileRngX = createRng(baseSeed ^ 0x51f15af1);
  const verticalLines = buildVerticalLines(context, settings, spacingRngX, profileRngX);
  const spacingRngY = settings.spacingJitter > 0 ? createRng(baseSeed ^ 0x4b1f2cd3) : null;
  const rows = buildAxisPositions(context.minY, context.maxY, settings.spacing, settings.spacingJitter, spacingRngY);
  const segmentAssignments = assignSegments(verticalLines, context, settings.cutSegments);
  const palette = buildPalette(settings);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = palette[0];
  ctx.fillRect(context.minX, context.minY, context.width, context.height);
  ctx.restore();

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette[0];

  drawVerticalLines(ctx, verticalLines, segmentAssignments, palette, settings, context);
  drawHorizontalSegments(ctx, verticalLines, segmentAssignments, rows, palette, settings, context, createRng(baseSeed ^ 0x6ac690c5));

  ctx.restore();
}

function drawVerticalLines(ctx, lines, segmentAssignments, palette, settings, context) {
  if (!lines.length) return;
  const sampleCount = Math.max(8, Math.ceil(context.height / Math.max(6, settings.spacing * 0.35)));
  for (const line of lines) {
    const colorIndex = pickColorForLine(line.index ?? 0, segmentAssignments, palette.length);
    ctx.strokeStyle = palette[colorIndex];
    ctx.lineWidth = Math.max(0.2, settings.lineWidth * line.weight);
    ctx.beginPath();
    for (let i = 0; i <= sampleCount; i++) {
      const t = i / sampleCount;
      const y = context.minY + context.height * t;
      const x = sampleVertical(line, y, context);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawHorizontalSegments(ctx, lines, segmentAssignments, rows, settings, context, rng) {
  if (lines.length < 2 || !rows.length) return;
  for (const row of rows) {
    const profile = createHorizontalProfile(rng, settings);
    const baseRowY = row + profile.baseJitter;
    const lineWidth = Math.max(0.2, settings.lineWidth * profile.weight);

    for (let i = 0; i < lines.length - 1; i++) {
      const segmentIndex = segmentAssignments[i];
      if (segmentIndex < 0) continue;
      const offsetActive = (segmentIndex % 2) === 1;
      const baseY = baseRowY + (offsetActive ? settings.offset : 0);
      const startLine = lines[i];
      const endLine = lines[i + 1];
      const baseStart = sampleVertical(startLine, baseY, context);
      const baseEnd = sampleVertical(endLine, baseY, context);
      const span = Math.max(Math.abs(baseEnd - baseStart), 1);
      const samples = Math.max(2, Math.ceil(span / Math.max(6, settings.spacing * 0.35)));

      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let s = 0; s <= samples; s++) {
        const t = s / samples;
        const wave = computeHorizontalWave(profile, t);
        const drawY = baseY + wave;
        const startX = sampleVertical(startLine, drawY, context);
        const endX = sampleVertical(endLine, drawY, context);
        let drawX;
        if (s === 0) {
          drawX = startX;
        } else if (s === samples) {
          drawX = endX;
        } else {
          const baseX = startX + (endX - startX) * t;
          const jitter = Math.sin(t * Math.PI * 2 + profile.xPhase) * profile.xWaveAmp;
          drawX = baseX + jitter;
        }
        if (s === 0) ctx.moveTo(drawX, drawY);
        else ctx.lineTo(drawX, drawY);
      }
      ctx.stroke();
    }
  }
}

function buildVerticalLines(context, settings, spacingRng, profileRng) {
  const basePositions = buildAxisPositions(context.minX, context.maxX, settings.spacing, settings.spacingJitter, spacingRng);
  const lines = [];
  let prevBase = -Infinity;
  for (const pos of basePositions) {
    const line = createVerticalProfile(pos, settings, profileRng);
    line.index = lines.length;
    if (line.base <= prevBase + 0.15) line.base = prevBase + 0.15;
    lines.push(line);
    prevBase = line.base;
  }
  return lines;
}

function buildAxisPositions(min, max, spacing, jitter = 0, rng = null) {
  const step = Math.max(2, spacing);
  const values = [];
  let v = min;
  let guard = 0;
  const useJitter = rng && jitter > 0;
  const minStep = Math.max(1.2, step * 0.35);
  const maxStep = step * (1 + jitter * 1.5);

  values.push(v);

  while (v < max && guard < 10000) {
    guard++;
    let nextStep = step;
    if (useJitter) {
      const factor = 1 + (rng() - 0.5) * 2 * jitter;
      nextStep = clampNumber(step * factor, minStep, maxStep);
    }
    v += nextStep;
    if (v >= max) break;
    values.push(v);
  }

  if (values[values.length - 1] < max - 1e-3) values.push(max);
  else values[values.length - 1] = max;

  return values;
}

function assignSegments(lines, context, requestedSegments) {
  const groupSize = Math.max(1, Math.round(requestedSegments));
  const cutCount = Math.max(1, Math.ceil((lines.length - 1) / groupSize));
  const assignments = new Array(Math.max(0, lines.length - 1)).fill(-1);
  if (!lines.length) return assignments;

  for (let i = 0; i < assignments.length; i++) {
    assignments[i] = Math.floor(i / groupSize);
  }

  return assignments;
}

function createVerticalProfile(position, settings, rng) {
  const organic = clamp01(settings.organic);
  const jitterScale = 0.35 + settings.spacingJitter * 0.9;
  const baseShift = (rng() - 0.5) * settings.spacing * 0.45 * organic * jitterScale;
  return {
    base: position + baseShift,
    lean: (rng() - 0.5) * 0.12 * organic,
    curve: (rng() - 0.5) * 0.06 * organic * jitterScale,
    wave1Amp: (rng() - 0.5) * settings.spacing * 0.22 * organic * jitterScale,
    wave2Amp: (rng() - 0.5) * settings.spacing * 0.12 * organic * jitterScale,
    wave3Amp: (rng() - 0.5) * settings.spacing * 0.08 * organic * jitterScale,
    wave1Phase: rng() * Math.PI * 2,
    wave2Phase: rng() * Math.PI * 2,
    wave3Phase: rng() * Math.PI * 2,
    weight: 1 + (rng() - 0.5) * 0.28 * organic,
  };
}

function sampleVertical(line, y, context) {
  const norm = clamp01((y - context.minY) / context.height);
  const span = y - context.minY;
  const centered = norm - 0.5;
  const curve = line.curve * centered * centered * context.height;
  const wave = Math.sin(Math.PI * norm + line.wave1Phase) * line.wave1Amp
    + Math.sin(Math.PI * 2 * norm + line.wave2Phase) * line.wave2Amp
    + Math.sin(Math.PI * 3 * norm + line.wave3Phase) * line.wave3Amp;
  return line.base + line.lean * span + curve + wave;
}

function createHorizontalProfile(rng, settings) {
  const organic = clamp01(settings.organic);
  const jitterScale = 0.25 + settings.spacingJitter * 0.9;
  return {
    baseJitter: (rng() - 0.5) * settings.spacing * 0.25 * organic * jitterScale,
    yWave1Amp: (rng() - 0.5) * settings.spacing * 0.2 * organic * jitterScale,
    yWave2Amp: (rng() - 0.5) * settings.spacing * 0.12 * organic * jitterScale,
    yPhase1: rng() * Math.PI * 2,
    yPhase2: rng() * Math.PI * 2,
    xWaveAmp: (rng() - 0.5) * settings.spacing * 0.16 * organic * jitterScale,
    xPhase: rng() * Math.PI * 2,
    weight: 1 + (rng() - 0.5) * 0.3 * organic,
  };
}

function computeHorizontalWave(profile, t) {
  return Math.sin(Math.PI * t + profile.yPhase1) * profile.yWave1Amp
    + Math.sin(Math.PI * 2 * t + profile.yPhase2) * profile.yWave2Amp;
}

function readHatchShearSettings(controls) {
  const spacing = Math.max(5, readNumber(controls?.hsSpace?.value, 20));
  const lineWidth = Math.max(0.2, readNumber(controls?.hsLW?.value, 1));
  const spacingJitter = clamp01(readNumber(controls?.hsSpacingJitter?.value, 0.35));
  const cutSegments = clampInt(readNumber(controls?.hsShearSegments?.value, 3), 1, 60);
  const offset = Math.max(0, readNumber(controls?.hsShearOffset?.value, 5));
  const organic = clamp01(readNumber(controls?.hsOrganic?.value, 0.75));
  const colorPrimary = readColor(controls?.hsColorA?.value) || (controls?.color?.value || '#111111');
  const colorSecondary = readColor(controls?.hsColorB?.value) || colorPrimary;
  return {
    spacing,
    lineWidth,
    spacingJitter,
    cutSegments,
    offset,
    organic,
    colorPrimary,
    colorSecondary,
  };
}

function readNumber(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
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
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
