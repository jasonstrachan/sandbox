import { buildSDF, gradientField, bilinearGrad } from '../utils/fields.js';
import { pointInPoly } from '../utils/geometry.js';

export function runFlow({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const seedSpacing = Number(controls.fSeed.value) || 0;
  const stepSize = Number(controls.fStep.value) || 0;
  const maxSteps = (Number(controls.fMax.value) || 0) | 0;
  const useOrtho = controls.fOrtho.checked;

  const sdfStep = Number(controls.cStep.value) || 8;
  const grid = buildSDF(sdfStep, state.pts, canvas.width, canvas.height);
  const { gx, gy } = gradientField(grid.nx, grid.ny, grid.step, grid.field);
  const grad = bilinearGrad(grid.minx, grid.miny, grid.step, grid.nx, grid.ny, gx, gy);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.strokeStyle = controls.color.value;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';

  for (let y = grid.miny; y <= grid.maxy; y += seedSpacing) {
    for (let x = grid.minx; x <= grid.maxx; x += seedSpacing) {
      const sx = x + (Math.random() - 0.5) * seedSpacing * 0.6;
      const sy = y + (Math.random() - 0.5) * seedSpacing * 0.6;
      if (!pointInPoly(sx, sy, state.pts)) continue;
      const forward = integrate({ x: sx, y: sy }, +1);
      const backward = integrate({ x: sx, y: sy }, -1).reverse();
      const path = backward.concat([{ x: sx, y: sy }], forward);
      if (path.length > 2) {
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
          ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.stroke();
      }
    }
  }

  ctx.restore();

  function integrate(start, direction) {
    const pts = [];
    let x = start.x;
    let y = start.y;
    for (let n = 0; n < maxSteps; n++) {
      if (!pointInPoly(x, y, state.pts)) break;
      const g = grad(x, y);
      let vx = g.gx;
      let vy = g.gy;
      if (useOrtho) {
        const t = vx;
        vx = -vy;
        vy = t;
      }
      const len = Math.hypot(vx, vy) || 1e-6;
      vx /= len;
      vy /= len;
      x += direction * vx * stepSize;
      y += direction * vy * stepSize;
      if (!pointInPoly(x, y, state.pts)) break;
      pts.push({ x, y });
    }
    return pts;
  }
}
