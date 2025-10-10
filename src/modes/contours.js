import { buildSDF, march } from '../utils/fields.js';

export function runContours({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const step = (Number(controls.cStep.value) || 0) | 0 || 8;
  const gap = Number(controls.cGap.value) || 0;
  const grid = buildSDF(step, state.pts, canvas.width, canvas.height);

  const levels = [];
  let maxD = 0;
  for (const v of grid.field) if (v > maxD) maxD = v;
  for (let level = gap; level <= maxD; level += gap) levels.push(level);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.strokeStyle = controls.color.value;
  ctx.lineWidth = 1.5;

  for (const iso of levels) {
    march(grid.minx, grid.miny, grid.step, grid.nx, grid.ny, grid.field, iso, (a, b) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
  }

  ctx.restore();
}
