export function vec2(x = 0, y = 0) {
  return { x, y };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v, s) {
  return { x: v.x * s, y: v.y * s };
}

export function rotate(v, radians) {
  if (radians === 0) return { ...v };
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function length(v) {
  return Math.hypot(v.x, v.y);
}

export function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function bbox(points) {
  if (!points?.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach((p) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function centroid(polyline) {
  if (!polyline?.length) return { x: 0, y: 0 };
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polyline.length; i += 1) {
    const a = polyline[i];
    const b = polyline[(i + 1) % polyline.length];
    const f = a.x * b.y - b.x * a.y;
    twiceArea += f;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  if (Math.abs(twiceArea) < 1e-5) {
    const avg = polyline.reduce(
      (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
      { x: 0, y: 0 }
    );
    return { x: avg.x / polyline.length, y: avg.y / polyline.length };
  }
  const inv = 1 / (3 * twiceArea);
  return { x: cx * inv, y: cy * inv };
}

export function polygonArea(polyline) {
  if (!polyline?.length) return 0;
  let area = 0;
  for (let i = 0; i < polyline.length; i += 1) {
    const a = polyline[i];
    const b = polyline[(i + 1) % polyline.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}
