import { buildSDF, gradientField, bilinearGrad, bilinearScalar } from '../utils/fields.js';
import { pointInPoly, smoothstep } from '../utils/geometry.js';

export function runGuidedFlow({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const dirAngle = (Number(controls.gAngle.value) || 0) * Math.PI / 180;
  const targetDir = { x: Math.cos(dirAngle), y: Math.sin(dirAngle) };
  const influence = Number(controls.gInfl.value) || 0;
  const seedStep = Number(controls.gSeed.value) || 0;
  const stepSize = Number(controls.gStep.value) || 0;
  const maxSteps = (Number(controls.gMax.value) || 0) | 0;

  const sdfStep = Number(controls.cStep.value) || 8;
  const grid = buildSDF(sdfStep, state.pts, canvas.width, canvas.height);
  const { gx, gy } = gradientField(grid.nx, grid.ny, grid.step, grid.field);
  const grad = bilinearGrad(grid.minx, grid.miny, grid.step, grid.nx, grid.ny, gx, gy);
  const dist = bilinearScalar(grid.minx, grid.miny, grid.step, grid.nx, grid.ny, grid.field);

  const edges = [];
  for (let i = 0; i < state.pts.length; i++) {
    const a = state.pts[i];
    const b = state.pts[(i + 1) % state.pts.length];
    edges.push([a, b]);
  }

  const seeds = [];
  for (const [a, b] of edges) {
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const samples = Math.max(2, Math.floor(segLen / seedStep));
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const g = grad(x, y);
      let nx = -g.gx;
      let ny = -g.gy;
      const nlen = Math.hypot(nx, ny);
      if (nlen <= 1e-6) continue;
      nx /= nlen;
      ny /= nlen;
      if (nx * targetDir.x + ny * targetDir.y < -0.15) {
        const inset = Math.max(1.5, stepSize * 0.6);
        const sx = x - nx * inset;
        const sy = y - ny * inset;
        if (pointInPoly(sx, sy, state.pts)) seeds.push({ x: sx, y: sy });
      }
    }
  }

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.strokeStyle = controls.color.value;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';

  for (const seed of seeds) {
    const path = integrate(seed);
    if (path.length > 1) {
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
      ctx.stroke();
    }
  }

  ctx.restore();

  function blendDir(x, y) {
    const g = grad(x, y);
    let nx = -g.gx;
    let ny = -g.gy;
    let nlen = Math.hypot(nx, ny);
    if (nlen <= 1e-6) return { vx: targetDir.x, vy: targetDir.y, nx: 0, ny: 0 };
    nx /= nlen;
    ny /= nlen;
    let tx = -ny;
    let ty = nx;
    if (tx * targetDir.x + ty * targetDir.y < 0) {
      tx = -tx;
      ty = -ty;
    }
    const w = smoothstep(0, influence, Math.max(0, dist(x, y)));
    let vx = (1 - w) * tx + w * targetDir.x;
    let vy = (1 - w) * ty + w * targetDir.y;
    const vlen = Math.hypot(vx, vy);
    if (vlen <= 1e-6) return { vx: targetDir.x, vy: targetDir.y, nx, ny };
    return { vx: vx / vlen, vy: vy / vlen, nx, ny };
  }

  function integrate(start) {
    const pts = [{ x: start.x, y: start.y }];
    let x = start.x;
    let y = start.y;
    let lastDir = null;

    for (let n = 0; n < maxSteps; n++) {
      if (!pointInPoly(x, y, state.pts)) break;
      let { vx, vy } = blendDir(x, y);
      if (lastDir) {
        vx = lastDir.x * 0.4 + vx * 0.6;
        vy = lastDir.y * 0.4 + vy * 0.6;
        const m = Math.hypot(vx, vy) || 1e-6;
        vx /= m;
        vy /= m;
      }
      let nx = x + vx * stepSize;
      let ny = y + vy * stepSize;
      if (!pointInPoly(nx, ny, state.pts)) {
        vx = -vx;
        vy = -vy;
        nx = x + vx * stepSize;
        ny = y + vy * stepSize;
        if (!pointInPoly(nx, ny, state.pts)) break;
      }
      x = nx;
      y = ny;
      pts.push({ x, y });
      lastDir = { x: vx, y: vy };
      const exit = blendDir(x, y);
      if (n > 12 && exit.nx * targetDir.x + exit.ny * targetDir.y > 0.35) break;
    }

    return pts;
  }
}
