import { Perlin } from '../utils/noise.js';
import { bbox, orientVectorInside, pointInPoly } from '../utils/geometry.js';

export function runNoiseFlow({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const strokeWidth = Number(controls.strokeLW.value) || 1.5;
  const seedSpacing = Math.max(1, Number(controls.nSeedSpace.value) || 1);
  const stepSize = Math.max(0.1, Number(controls.nStep.value) || 0.1);
  const maxSteps = Math.max(1, (Number(controls.nMax.value) || 0) | 0);
  const scale = Math.max(1, Number(controls.nScale.value) || 1);
  const octaves = Math.max(1, (Number(controls.nOct.value) || 0) | 0);
  const angleOffset = (Number(controls.nAngle.value) || 0) * Math.PI / 180;
  const useCurl = controls.nCurl.checked;
  const seed = (Number(controls.nSeed.value) || 0) | 0;

  const field = new Perlin(seed);

  ctx.save();
  helpers.tracePolygonPath();
  ctx.clip('nonzero');
  ctx.strokeStyle = controls.color.value;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';

  const bounds = bbox(state.pts);
  const pad = 8;
  const minx = Math.max(0, Math.floor((bounds.minx - pad) / seedSpacing) * seedSpacing);
  const miny = Math.max(0, Math.floor((bounds.miny - pad) / seedSpacing) * seedSpacing);
  const maxx = Math.min(canvas.width, Math.ceil((bounds.maxx + pad) / seedSpacing) * seedSpacing);
  const maxy = Math.min(canvas.height, Math.ceil((bounds.maxy + pad) / seedSpacing) * seedSpacing);

  for (let y = miny; y <= maxy; y += seedSpacing) {
    for (let x = minx; x <= maxx; x += seedSpacing) {
      const sx = x + (Math.random() - 0.5) * seedSpacing * 0.6;
      const sy = y + (Math.random() - 0.5) * seedSpacing * 0.6;
      if (!pointInPoly(sx, sy, state.pts)) continue;
      const path = integrate({ x: sx, y: sy });
      if (path.length > 1) {
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
    }
  }

  ctx.restore();

  function vecAt(x, y) {
    const u = x / scale;
    const v = y / scale;
    if (!useCurl) {
      const angle = field.fbm2(u, v, octaves) * Math.PI * 2 + angleOffset;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    }
    const eps = 0.5 / scale;
    const nx1 = field.fbm2(u + eps, v, octaves);
    const nx0 = field.fbm2(u - eps, v, octaves);
    const ny1 = field.fbm2(u, v + eps, octaves);
    const ny0 = field.fbm2(u, v - eps, octaves);
    const dn_dx = (nx1 - nx0) / (2 * eps);
    const dn_dy = (ny1 - ny0) / (2 * eps);
    let vx = dn_dy;
    let vy = -dn_dx;
    const len = Math.hypot(vx, vy) || 1e-6;
    return { x: vx / len, y: vy / len };
  }

  function integrate(start) {
    const pts = [{ x: start.x, y: start.y }];
    let x = start.x;
    let y = start.y;
    for (let n = 0; n < maxSteps; n++) {
      if (!pointInPoly(x, y, state.pts)) break;
      let v = vecAt(x, y);
      v = orientVectorInside(x, y, stepSize, v, state.pts);
      if (!v) break;
      const mx = x + v.x * stepSize * 0.5;
      const my = y + v.y * stepSize * 0.5;
      let vm = vecAt(mx, my);
      vm = orientVectorInside(x, y, stepSize, vm, state.pts);
      if (!vm) break;
      x += vm.x * stepSize;
      y += vm.y * stepSize;
      if (!pointInPoly(x, y, state.pts)) break;
      pts.push({ x, y });
    }
    return pts;
  }
}
