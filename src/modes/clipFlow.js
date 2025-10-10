import {
  bbox,
  linePolyIntersections,
  nearestEdgeInfo,
  pointInPoly,
  polygonCentroid,
  smoothstep,
} from '../utils/geometry.js';

export function runClippedFlow({ canvas, ctx, state, controls, helpers }) {
  if (!helpers.ensureClosed()) return;
  helpers.prepareRender();

  const angle = (Number(controls.clipAngle.value) || 0) * Math.PI / 180;
  let spacing = Number(controls.clipSpacing.value) || 16;
  const lineWidth = Number(controls.clipLW.value) || 1.5;
  spacing = Math.max(1, spacing);

  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -dir.y, y: dir.x };
  const center = polygonCentroid(state.pts);
  const bb = bbox(state.pts);
  const diag = Math.hypot(bb.maxx - bb.minx, bb.maxy - bb.miny) || 1;
  const nearScale = sanitizeScale(controls.clipFalloffNear?.value, 1, 0.15, 4);
  const farScale = sanitizeScale(controls.clipFalloffFar?.value, 1, 0.15, 5);
  const baseNear = Math.max(spacing * 3.8, diag * 0.06, 18);
  const turnReachNear = baseNear * nearScale;
  const baseFar = Math.max(turnReachNear * 2.6, diag * 0.22, spacing * 7, 48);
  const turnReachFar = baseFar * farScale;
  const stepAlongT = Math.max(1.05, spacing * 0.42);
  const maxStep = Math.max(stepAlongT * 2.15, spacing * 1.45, 2.7);
  const minNodeGap = 0.32;

  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const p of state.pts) {
    const proj = (p.x - center.x) * normal.x + (p.y - center.y) * normal.y;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }

  const margin = diag * 0.5 + spacing * 2;
  minProj -= margin;
  maxProj += margin;
  const startOffset = Math.floor(minProj / spacing) * spacing;
  const endOffset = Math.ceil(maxProj / spacing) * spacing;
  const maxT = diag * 1.5;

  ctx.save();
  ctx.strokeStyle = controls.color.value;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';

  for (let offset = startOffset; offset <= endOffset; offset += spacing) {
    const base = {
      x: center.x + normal.x * offset,
      y: center.y + normal.y * offset,
    };
    const ts = linePolyIntersections(base, dir, state.pts);
    if (ts.length < 2) continue;
    for (let i = 0; i + 1 < ts.length; i += 2) {
      let t0 = ts[i];
      let t1 = ts[i + 1];
      if (Math.abs(t1 - t0) < 1e-4) continue;
      t0 = Math.max(-maxT, Math.min(maxT, t0));
      t1 = Math.max(-maxT, Math.min(maxT, t1));
      const curve = buildSegment(base, t0, t1);
      if (!curve || curve.length < 2) {
        const x0 = base.x + dir.x * t0;
        const y0 = base.y + dir.y * t0;
        const x1 = base.x + dir.x * t1;
        const y1 = base.y + dir.y * t1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(curve[0].x, curve[0].y);
      for (let k = 1; k < curve.length; k++) {
        ctx.lineTo(curve[k].x, curve[k].y);
      }
      ctx.stroke();
    }
  }

  ctx.restore();

  function buildSegment(base, t0, t1) {
    if (t1 <= t0 + 1e-3) return null;

    const startPoint = {
      x: base.x + dir.x * t0,
      y: base.y + dir.y * t0,
    };
    const endPoint = {
      x: base.x + dir.x * t1,
      y: base.y + dir.y * t1,
    };

    const span = t1 - t0;
    if (span <= stepAlongT * 0.75) {
      return [startPoint, endPoint];
    }

    const interiorMargin = Math.min(
      span * 0.25,
      Math.max(stepAlongT * 0.8, 0.9)
    );
    let startT = t0 + interiorMargin;
    let endT = t1 - interiorMargin;
    if (startT >= endT) {
      startT = t0 + span * 0.33;
      endT = t1 - span * 0.33;
      if (startT >= endT) return [startPoint, endPoint];
    }

    let x = base.x + dir.x * startT;
    let y = base.y + dir.y * startT;
    if (!pointInPoly(x, y, state.pts)) {
      const toCenterX = center.x - x;
      const toCenterY = center.y - y;
      const pullLen = Math.hypot(toCenterX, toCenterY) || 1;
      const nudge = Math.min(1.2, span * 0.12);
      x += (toCenterX / pullLen) * nudge;
      y += (toCenterY / pullLen) * nudge;
      if (!pointInPoly(x, y, state.pts)) return [startPoint, endPoint];
    }

    let t = startT;
    const pts = [startPoint, { x, y }];
    let prevDir = null;
    const guard = Math.max(10, Math.ceil((endT - startT) / stepAlongT) * 4);

    for (let iter = 0; iter < guard && t < endT - 1e-3; iter++) {
      let flow = flowDirAt(x, y);
      if (prevDir) {
        flow = normalize({
          x: flow.x * 0.65 + prevDir.x * 0.35,
          y: flow.y * 0.65 + prevDir.y * 0.35,
        });
      }
      let dot = flow.x * dir.x + flow.y * dir.y;
      if (dot < 0.12) {
        flow = normalize({
          x: flow.x + dir.x * 0.6,
          y: flow.y + dir.y * 0.6,
        });
        dot = Math.max(0.12, flow.x * dir.x + flow.y * dir.y);
      }

      let deltaT = Math.min(stepAlongT, endT - t);
      let step = deltaT / dot;
      if (!Number.isFinite(step) || step <= 0) break;
      if (step > maxStep) {
        step = maxStep;
        deltaT = step * dot;
      }

      let nx = x + flow.x * step;
      let ny = y + flow.y * step;
      if (!pointInPoly(nx, ny, state.pts)) {
        let shrink = 0.6;
        let fixed = false;
        while (shrink > 0.05) {
          const sx = x + flow.x * step * shrink;
          const sy = y + flow.y * step * shrink;
          if (pointInPoly(sx, sy, state.pts)) {
            nx = sx;
            ny = sy;
            deltaT *= shrink;
            fixed = true;
            break;
          }
          shrink *= 0.5;
        }
        if (!fixed) break;
      }

      x = nx;
      y = ny;
      t += deltaT;
      prevDir = flow;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(last.x - x, last.y - y) > minNodeGap) {
        pts.push({ x, y });
      } else {
        pts[pts.length - 1] = { x, y };
      }
    }

    const tail = pts[pts.length - 1];
    if (Math.hypot(tail.x - endPoint.x, tail.y - endPoint.y) > 0.6) {
      const anchorT = Math.max(startT, Math.min(endT, t));
      const anchor = {
        x: base.x + dir.x * anchorT,
        y: base.y + dir.y * anchorT,
      };
      if (Math.hypot(tail.x - anchor.x, tail.y - anchor.y) > 0.5) {
        pts.push(anchor);
      }
      pts.push(endPoint);
    } else {
      pts[pts.length - 1] = endPoint;
    }

    return pts;
  }

  function flowDirAt(x, y) {
    const info = nearestEdgeInfo(x, y, state.pts);
    if (!info) return dir;
    let tx = info.tx;
    let ty = info.ty;
    if (tx * dir.x + ty * dir.y < 0) {
      tx = -tx;
      ty = -ty;
    }
    const dist = Math.max(0, info.distance);
    const near = 1 - smoothstep(0, turnReachNear, dist);
    const far = 1 - smoothstep(0, turnReachFar, dist);
    const blend = Math.pow(Math.max(near, far * 0.65), 0.9);
    let vx = (1 - blend) * dir.x + blend * tx;
    let vy = (1 - blend) * dir.y + blend * ty;
    if (info.inside) {
      const inward = (1 - Math.min(1, dist / (turnReachFar || 1))) * 0.16;
      vx -= info.nx * inward;
      vy -= info.ny * inward;
    }
    return normalize({ x: vx, y: vy });
  }

  function normalize(v) {
    const len = Math.hypot(v.x, v.y);
    if (len <= 1e-6 || !Number.isFinite(len)) return { x: dir.x, y: dir.y };
    return { x: v.x / len, y: v.y / len };
  }

  function sanitizeScale(raw, fallback, min, max) {
    const val = Number(raw);
    if (!Number.isFinite(val)) return fallback;
    return Math.min(max, Math.max(min, val));
  }
}
