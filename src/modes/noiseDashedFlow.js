import { Perlin } from '../utils/noise.js';
import {
  bbox,
  nearestEdgeInfo,
  orientVectorInside,
  pointInPoly,
  smoothstep,
} from '../utils/geometry.js';
import { poissonInPolygon } from '../utils/seeding.js';

export function runNoiseDashedFlow({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const strokeWidth = Number(controls.strokeLW.value) || 1.5;
  const seedSpacing = Math.max(1, Number(controls.ndSeedSpace.value) || 1);
  const stepSize = Math.max(0.1, Number(controls.ndStep.value) || 0.1);
  const maxSteps = Math.max(1, (Number(controls.ndMax.value) || 0) | 0);
  const scale = Math.max(1, Number(controls.ndScale.value) || 1);
  const octaves = Math.max(1, (Number(controls.ndOct.value) || 0) | 0);
  const angleOffset = (Number(controls.ndAngle.value) || 0) * Math.PI / 180;
  const seed = (Number(controls.ndSeed.value) || 0) | 0;
  const dash = Math.max(0.1, Number(controls.ndDash.value) || 0.1);
  const gap = Math.max(0.1, Number(controls.ndGap.value) || 0.1);
  const jitter = Math.max(0, Number(controls.ndJitter.value) || 0);
  const nearScale = sanitizeScale(controls.ndFalloffNear?.value, 1, 0.15, 4);
  const farScale = sanitizeScale(controls.ndFalloffFar?.value, 1, 0.15, 5);
  const randomPhase = controls.ndPhase.checked;
  const even = controls.ndEven.checked;

  const field = new Perlin(seed);
  const bb = bbox(state.pts);
  const diag = Math.hypot(bb.maxx - bb.minx, bb.maxy - bb.miny) || 1;
  const baseNear = Math.max(stepSize * 4.2, seedSpacing * 2.2, diag * 0.05, 14);
  const turnReachNear = baseNear * nearScale;
  const baseFar = Math.max(turnReachNear * 2.4, seedSpacing * 5, diag * 0.18, 38);
  const turnReachFar = baseFar * farScale;
  const inwardBias = 0.14;

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.strokeStyle = controls.color.value;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'butt';

  const seeds = even ? poissonInPolygon(seedSpacing, state.pts, canvas.width, canvas.height) : gridSeeds(seedSpacing);
  for (const seedPoint of seeds) {
    const path = integrate(seedPoint);
    if (path.length > 1) dashed(path);
  }

  ctx.restore();

  function gridSeeds(step) {
    const arr = [];
    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const sx = x + (Math.random() - 0.5) * step * 0.6;
        const sy = y + (Math.random() - 0.5) * step * 0.6;
        if (pointInPoly(sx, sy, state.pts)) arr.push({ x: sx, y: sy });
      }
    }
    return arr;
  }

  function vecAt(x, y) {
    const u = x / scale;
    const v = y / scale;
    const angle = field.fbm2(u, v, octaves) * Math.PI * 2 + angleOffset;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  function integrate(start) {
    const pts = [{ x: start.x, y: start.y }];
    let x = start.x;
    let y = start.y;
    let prevDir = null;
    for (let n = 0; n < maxSteps; n++) {
      if (!pointInPoly(x, y, state.pts)) break;
      let baseVec = normalize(vecAt(x, y));
      if (prevDir) {
        baseVec = normalize({
          x: baseVec.x * 0.65 + prevDir.x * 0.35,
          y: baseVec.y * 0.65 + prevDir.y * 0.35,
        });
      }
      const flow = flowDirAt(x, y, baseVec);
      let stepVec = orientVectorInside(x, y, stepSize, flow, state.pts);
      if (!stepVec) break;
      const len = Math.hypot(stepVec.x, stepVec.y) || 1e-6;
      stepVec = { x: stepVec.x / len, y: stepVec.y / len };
      x += stepVec.x * stepSize;
      y += stepVec.y * stepSize;
      if (!pointInPoly(x, y, state.pts)) break;
      pts.push({ x, y });
      prevDir = stepVec;
    }
    return pts;
  }

  function dashed(pts) {
    let phase = randomPhase ? Math.random() * (dash + gap) : 0;
    let on = phase < dash;
    let remaining = on ? dash - phase : gap + dash - phase;

    for (let i = 1; i < pts.length; i++) {
      let x0 = pts[i - 1].x;
      let y0 = pts[i - 1].y;
      let x1 = pts[i].x;
      let y1 = pts[i].y;
      let segLen = Math.hypot(x1 - x0, y1 - y0);
      if (segLen <= 1e-6) continue;
      let ux = (x1 - x0) / segLen;
      let uy = (y1 - y0) / segLen;
      let a = 0;
      while (a < segLen) {
        let step = Math.min(remaining, segLen - a);
        let drawStep = step;
        if (on && jitter > 0) {
          drawStep = step * (1 + (Math.random() - 0.5) * jitter);
        }
        if (on) {
          ctx.beginPath();
          ctx.moveTo(x0 + ux * a, y0 + uy * a);
          ctx.lineTo(x0 + ux * (a + drawStep), y0 + uy * (a + drawStep));
          ctx.stroke();
        }
        a += step;
        remaining -= step;
        if (remaining <= 1e-6) {
          on = !on;
          remaining = on ? dash : gap;
        }
      }
    }
  }

  function flowDirAt(x, y, baseVec) {
    const info = nearestEdgeInfo(x, y, state.pts);
    if (!info) return baseVec;
    let tx = info.tx;
    let ty = info.ty;
    if (tx * baseVec.x + ty * baseVec.y < 0) {
      tx = -tx;
      ty = -ty;
    }
    const dist = Math.max(0, info.distance);
    const near = 1 - smoothstep(0, turnReachNear, dist);
    const far = 1 - smoothstep(0, turnReachFar, dist);
    const blend = Math.pow(Math.max(near, far * 0.62), 0.9);
    let vx = (1 - blend) * baseVec.x + blend * tx;
    let vy = (1 - blend) * baseVec.y + blend * ty;
    if (info.inside) {
      const inward = (1 - Math.min(1, dist / (turnReachFar || 1))) * inwardBias;
      vx -= info.nx * inward;
      vy -= info.ny * inward;
    }
    return normalize({ x: vx, y: vy });
  }

  function normalize(v) {
    const len = Math.hypot(v.x, v.y);
    if (len <= 1e-6 || !Number.isFinite(len)) return { x: 1, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  function sanitizeScale(raw, fallback, min, max) {
    const val = Number(raw);
    if (!Number.isFinite(val)) return fallback;
    return Math.min(max, Math.max(min, val));
  }
}
