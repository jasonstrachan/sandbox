import { polygonCentroid, bbox } from '../utils/geometry.js';

const TAU = Math.PI * 2;

export function runSpiralBloom({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const polygon = state.pts;
  if (!polygon || polygon.length < 3) return;

  const color = controls.color?.value || '#ffffff';
  const strokeWidth = Math.max(0.2, readNumber(controls.strokeLW, 1.4));
  const originMode = controls.spiralBloomOrigin?.value || 'mixed';
  const armCount = clamp(Math.round(readNumber(controls.spiralBloomArms, 6)), 1, 48);
  const turns = clamp(readNumber(controls.spiralBloomTurns, 4.5), 0.6, 12);
  const tightness = clamp(readNumber(controls.spiralBloomTightness, 0.12), 0.015, 0.5);
  const wobble = clamp(readNumber(controls.spiralBloomWobble, 18), 0, 180);
  const density = clamp(Math.round(readNumber(controls.spiralBloomDensity, 90)), 24, 260);
  const phaseDeg = readNumber(controls.spiralBloomPhase, 0);
  const jitterAmount = clamp(readNumber(controls.spiralBloomJitter, 0.35), 0, 1.2);
  const seed = readInt(controls.spiralBloomSeed, 1337);
  const cornerPull = clamp(readNumber(controls.spiralBloomCornerPull, 0.78), 0.4, 0.98);
  const startRadiusInput = Math.max(2, readNumber(controls.spiralBloomStartRadius, NaN));

  const centroid = polygonCentroid(polygon);
  const { minx, miny, maxx, maxy } = bbox(polygon);
  const diagonal = Math.hypot(maxx - minx, maxy - miny);
  const startRadius = Number.isFinite(startRadiusInput)
    ? startRadiusInput
    : Math.max(6, diagonal * 0.035);
  const maxRadius = diagonal * 0.85 + 80;

  const baseHash = hashPoints(polygon);
  const rng = createRng(baseHash ^ seed);

  const anchors = computeAnchors(polygon, centroid, originMode, cornerPull, rng);
  if (!anchors.length) anchors.push(centroid);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const phaseBase = degToRad(phaseDeg);
  const thetaStep = TAU / density;
  const maxTheta = turns * TAU;

  for (let a = 0; a < anchors.length; a++) {
    const anchor = anchors[a];
    const anchorRng = createRng((baseHash ^ seed) + a * 0x9e3779b9);
    const anchorPhase = (anchorRng() - 0.5) * 0.9;
    const wobblePhase = anchorRng() * TAU;
    const wobbleFreq = 0.45 + anchorRng() * 0.9;
    const angleFreq = 0.22 + anchorRng() * 0.45;

    for (let arm = 0; arm < armCount; arm++) {
      const t = arm / armCount;
      const baseAngle = phaseBase + anchorPhase + t * TAU;
      const armDrift = (anchorRng() - 0.5) * jitterAmount * 0.8;
      const path = traceSpiral({
        anchor,
        baseAngle,
        startRadius,
        tightness,
        maxTheta,
        thetaStep,
        wobble,
        wobbleFreq,
        wobblePhase: wobblePhase + arm * 0.37,
        angleFreq,
        anglePhase: anchorRng() * TAU,
        angleJitter: jitterAmount,
        armDrift,
        maxRadius,
      });
      if (path.length < 2) continue;

      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        const p = path[i];
        ctx.lineTo(p.x, p.y);
      }

      const widthMod = 0.78 + (anchorRng() - 0.5) * 0.3;
      const alphaMod = 0.48 + (1 - t) * 0.42;
      ctx.lineWidth = Math.max(0.18, strokeWidth * widthMod);
      ctx.strokeStyle = colorWithAlpha(color, clamp01(alphaMod));
      ctx.stroke();
    }
  }

  ctx.restore();
}

function traceSpiral(options) {
  const {
    anchor,
    baseAngle,
    startRadius,
    tightness,
    maxTheta,
    thetaStep,
    wobble,
    wobbleFreq,
    wobblePhase,
    angleFreq,
    anglePhase,
    angleJitter,
    armDrift,
    maxRadius,
  } = options;

  const points = [];
  for (let theta = 0; theta <= maxTheta; theta += thetaStep) {
    const radius = startRadius * Math.exp(tightness * theta);
    if (radius > maxRadius) break;
    const wobbleOffset = wobble * Math.sin(theta * wobbleFreq + wobblePhase);
    const angleOffset = angleJitter * 0.55 * Math.sin(theta * angleFreq + anglePhase) + armDrift;
    const totalRadius = Math.max(0, radius + wobbleOffset);
    const angle = baseAngle + theta + angleOffset;
    const x = anchor.x + Math.cos(angle) * totalRadius;
    const y = anchor.y + Math.sin(angle) * totalRadius;
    points.push({ x, y });
  }
  return points;
}

function computeAnchors(polygon, centroid, mode, cornerPull, rng) {
  const anchors = [];
  if (mode === 'centroid' || mode === 'mixed') {
    anchors.push({ x: centroid.x, y: centroid.y });
  }
  if (mode === 'corners' || mode === 'mixed') {
    const dirs = [
      { x: 1, y: 1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
      { x: 1, y: -1 },
    ];
    for (const dir of dirs) {
      let best = null;
      let bestScore = -Infinity;
      for (const p of polygon) {
        const score = p.x * dir.x + p.y * dir.y;
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
      if (!best) continue;
      const offset = {
        x: centroid.x + (best.x - centroid.x) * cornerPull,
        y: centroid.y + (best.y - centroid.y) * cornerPull,
      };
      const jitterRadius = Math.hypot(best.x - centroid.x, best.y - centroid.y) * 0.08;
      const theta = rng() * TAU;
      const jitter = jitterRadius * 0.6;
      anchors.push({
        x: offset.x + Math.cos(theta) * jitter,
        y: offset.y + Math.sin(theta) * jitter,
      });
    }
  }

  return dedupeAnchors(anchors);
}

function dedupeAnchors(points) {
  const unique = [];
  for (const p of points) {
    if (!unique.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 4)) {
      unique.push(p);
    }
  }
  return unique;
}

function readNumber(input, fallback) {
  if (!input) return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function readInt(input, fallback) {
  if (!input) return fallback;
  const value = Number.parseInt(input.value, 10);
  return Number.isFinite(value) ? value : fallback;
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

function degToRad(deg) {
  return (deg / 180) * Math.PI;
}

function colorWithAlpha(color, alpha) {
  const a = clamp01(alpha);
  if (!color) return `rgba(255, 255, 255, ${a})`;
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
  }
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const parts = match[1].split(',').map((part) => part.trim());
    const r = parts[0] || '255';
    const g = parts[1] || '255';
    const b = parts[2] || '255';
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return color;
}

function createRng(seed) {
  let s = seed | 0;
  if (s === 0) s = 0x6d2b79f5;
  return function rng() {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff);
  };
}

function hashPoints(points) {
  let h = 2166136261;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    let x = Math.floor(p.x * 1.618);
    let y = Math.floor(p.y * 1.618);
    h ^= x + 0x9e3779b9 + (h << 6) + (h >> 2);
    h ^= y + 0x85ebca6b + (h << 6) + (h >> 2);
  }
  return h >>> 0;
}
