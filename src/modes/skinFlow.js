import { buildSDF, gradientField, bilinearGrad, bilinearScalar } from '../utils/fields.js';
import { orientVectorInside, pointInPoly, smoothstep } from '../utils/geometry.js';
import { poissonInPolygon } from '../utils/seeding.js';

export function runSkinFlow({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const angle = (Number(controls.skinAngle.value) || 0) * Math.PI / 180;
  let spacing = Number(controls.skinSpacing.value) || 35;
  let falloff = Number(controls.skinFalloff.value) || 100;
  let rawStep = Number(controls.skinStep.value);
  if (!Number.isFinite(rawStep) || rawStep === 0) rawStep = 1;
  const stepPolarity = rawStep < 0 ? -1 : 1;
  const stepLen = Math.max(0.5, Math.abs(rawStep));
  spacing = Math.max(1, spacing);
  falloff = Math.max(1e-3, falloff);
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };

  const sdfStep = Math.max(3, Math.min(12, stepLen * 1.5));
  const grid = buildSDF(sdfStep, state.pts, canvas.width, canvas.height);
  const { gx, gy } = gradientField(grid.nx, grid.ny, grid.step, grid.field);
  const grad = bilinearGrad(grid.minx, grid.miny, grid.step, grid.nx, grid.ny, gx, gy);
  const distSample = bilinearScalar(grid.minx, grid.miny, grid.step, grid.nx, grid.ny, grid.field);

  const seeds = poissonInPolygon(Math.max(3, spacing * 0.9), state.pts, canvas.width, canvas.height);
  const gridStep = Math.max(5, spacing * 0.85);
  for (let y = grid.miny; y <= grid.maxy; y += gridStep) {
    for (let x = grid.minx; x <= grid.maxx; x += gridStep) {
      const sx = x + (Math.random() - 0.5) * gridStep * 0.45;
      const sy = y + (Math.random() - 0.5) * gridStep * 0.45;
      if (pointInPoly(sx, sy, state.pts)) seeds.push({ x: sx, y: sy });
    }
  }

  const cellSize = Math.max(3, spacing * 0.55);
  const key = (x, y) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
  const counts = new Map();
  const overlapLimit = 0.48;
  const targetCoverage = 2;

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.strokeStyle = controls.color.value;
  ctx.lineWidth = 1.02;
  ctx.lineCap = 'round';

  for (const seed of seeds) {
    const forward = integrateStream(seed.x, seed.y, +1);
    const backward = integrateStream(seed.x, seed.y, -1);
    if (forward.length <= 1 && backward.length <= 1) continue;
    if (backward.length) backward.shift();
    backward.reverse();
    const path = backward.concat(forward);
    if (path.length < 2) continue;

    let overlap = 0;
    let needsCoverage = false;
    for (const p of path) {
      const k = key(p.x, p.y);
      const c = counts.get(k) || 0;
      if (c > 0) overlap++;
      if (c < targetCoverage) needsCoverage = true;
    }

    const ratio = overlap / path.length;
    if (ratio > overlapLimit && !needsCoverage) continue;

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();

    for (const p of path) {
      const k = key(p.x, p.y);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }

  ctx.restore();

  function flowDir(x, y) {
    if (x < grid.minx || y < grid.miny || x > grid.maxx || y > grid.maxy) return null;
    const g = grad(x, y);
    let gxv = g.gx;
    let gyv = g.gy;
    const glen = Math.hypot(gxv, gyv);
    if (glen <= 1e-6) {
      return { x: dir.x, y: dir.y };
    }
    gxv /= glen;
    gyv /= glen;
    let tx = -gyv;
    let ty = gxv;
    if (tx * dir.x + ty * dir.y < 0) {
      tx *= -1;
      ty *= -1;
    }
    const dist = Math.max(0, distSample(x, y));
    const w = smoothstep(0, falloff, dist);
    let vx = (1 - w) * dir.x + w * tx;
    let vy = (1 - w) * dir.y + w * ty;
    const inward = 0.12 * (1 - Math.min(1, dist / (falloff || 1)));
    vx -= gxv * inward;
    vy -= gyv * inward;
    const vlen = Math.hypot(vx, vy);
    if (vlen <= 1e-6) return null;
    return { x: vx / vlen, y: vy / vlen };
  }

  function integrateStream(startX, startY, sign) {
    const pts = [{ x: startX, y: startY }];
    let x = startX;
    let y = startY;
    let prevDir = null;

    for (let iter = 0; iter < 2000; iter++) {
      if (!pointInPoly(x, y, state.pts)) break;
      const base = flowDir(x, y);
      if (!base) break;
      let vx = base.x * sign * stepPolarity;
      let vy = base.y * sign * stepPolarity;
      if (prevDir) {
        vx = prevDir.x * 0.45 + vx * 0.55;
        vy = prevDir.y * 0.45 + vy * 0.55;
      }
      let stepVec = orientVectorInside(x, y, stepLen, { x: vx, y: vy }, state.pts);
      if (!stepVec) break;
      const midX = x + stepVec.x * stepLen * 0.5;
      const midY = y + stepVec.y * stepLen * 0.5;
      const mid = flowDir(midX, midY);
      if (mid) {
        let mx = mid.x * sign * stepPolarity;
        let my = mid.y * sign * stepPolarity;
        if (prevDir) {
          mx = prevDir.x * 0.45 + mx * 0.55;
          my = prevDir.y * 0.45 + my * 0.55;
        }
        const midVec = orientVectorInside(x, y, stepLen, { x: mx, y: my }, state.pts);
        if (midVec) stepVec = midVec;
      }
      const len = Math.hypot(stepVec.x, stepVec.y) || 1e-6;
      stepVec = { x: stepVec.x / len, y: stepVec.y / len };
      const nx = x + stepVec.x * stepLen;
      const ny = y + stepVec.y * stepLen;
      if (!pointInPoly(nx, ny, state.pts)) break;
      x = nx;
      y = ny;
      pts.push({ x, y });
      prevDir = { x: stepVec.x, y: stepVec.y };
    }

    return pts;
  }
}
