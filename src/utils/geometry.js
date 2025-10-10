export function pointInPoly(x, y, pts) {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function smoothstep(edge0, edge1, x) {
  if (edge1 === edge0) return x >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function bbox(pts) {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const p of pts) {
    if (p.x < minx) minx = p.x;
    if (p.y < miny) miny = p.y;
    if (p.x > maxx) maxx = p.x;
    if (p.y > maxy) maxy = p.y;
  }
  return { minx, miny, maxx, maxy };
}

export function segDist(x, y, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = x - x1;
  const wy = y - y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(x - x1, y - y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(x - x2, y - y2);
  const t = c1 / c2;
  const px = x1 + t * vx;
  const py = y1 + t * vy;
  return Math.hypot(x - px, y - py);
}

function closestPointOnSegment(x, y, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = 0;
  if (len2 > 1e-12) {
    t = ((x - ax) * vx + (y - ay) * vy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  return { px: ax + vx * t, py: ay + vy * t, t };
}

export function distanceToPolygon(x, y, pts) {
  let d = Infinity;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const di = segDist(x, y, a.x, a.y, b.x, b.y);
    if (di < d) d = di;
  }
  return pointInPoly(x, y, pts) ? d : -d;
}

export function polygonCentroid(pts) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / (pts.length || 1), y: sy / (pts.length || 1) };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

export function nearestEdgeInfo(x, y, pts) {
  if (!pts.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const closest = closestPointOnSegment(x, y, a.x, a.y, b.x, b.y);
    const dx = closest.px - x;
    const dy = closest.py - y;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = {
        px: closest.px,
        py: closest.py,
        edgeDx: b.x - a.x,
        edgeDy: b.y - a.y,
        distDx: dx,
        distDy: dy,
      };
    }
  }
  if (!best) return null;
  const inside = pointInPoly(x, y, pts);
  const sign = inside ? 1 : -1;
  const distance = bestDist * sign;
  let nx = 0;
  let ny = 0;
  if (bestDist > 1e-9) {
    nx = (best.distDx / bestDist) * sign;
    ny = (best.distDy / bestDist) * sign;
  }
  const edgeLen = Math.hypot(best.edgeDx, best.edgeDy) || 1;
  const tx = best.edgeDx / edgeLen;
  const ty = best.edgeDy / edgeLen;
  return { distance, nx, ny, tx, ty, px: best.px, py: best.py, inside };
}

export function lineSegIntersectT(p0, dir, a, b) {
  const rx = dir.x;
  const ry = dir.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const apx = a.x - p0.x;
  const apy = a.y - p0.y;
  const t = (apx * sy - apy * sx) / denom;
  const u = (apx * ry - apy * rx) / denom;
  if (u >= -1e-9 && u <= 1 + 1e-9) return t;
  return null;
}

export function linePolyIntersections(p0, dir, pts) {
  const ts = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const t = lineSegIntersectT(p0, dir, a, b);
    if (t !== null) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  return ts;
}

export function orientVectorInside(x, y, step, vector, pts) {
  const forward = { x: vector.x, y: vector.y };
  if (pointInPoly(x + forward.x * step, y + forward.y * step, pts)) {
    return forward;
  }
  const backward = { x: -forward.x, y: -forward.y };
  if (pointInPoly(x + backward.x * step, y + backward.y * step, pts)) {
    return backward;
  }
  return null;
}
