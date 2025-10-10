import { pointInPoly } from './geometry.js';

export function poissonInPolygon(minDist, pts, width, height, rng = Math.random) {
  const k = 30;
  const r = minDist;
  const cell = r / Math.SQRT2;
  const gridW = Math.ceil(width / cell);
  const gridH = Math.ceil(height / cell);
  const grid = new Array(gridW * gridH).fill(-1);
  const samples = [];
  const active = [];

  function gridIdx(x, y) {
    return Math.floor(y / cell) * gridW + Math.floor(x / cell);
  }

  function farEnough(x, y) {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const nx = gx + i;
        const ny = gy + j;
        if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
        const idx = ny * gridW + nx;
        const sidx = grid[idx];
        if (sidx >= 0) {
          const s = samples[sidx];
          if (Math.hypot(s.x - x, s.y - y) < r) return false;
        }
      }
    }
    return true;
  }

  let initTries = 0;
  while (initTries++ < 1000) {
    const x = r + rng() * (width - 2 * r);
    const y = r + rng() * (height - 2 * r);
    if (pointInPoly(x, y, pts)) {
      samples.push({ x, y });
      active.push({ x, y });
      grid[gridIdx(x, y)] = 0;
      break;
    }
  }

  if (!samples.length) return samples;

  while (active.length) {
    const aidx = (rng() * active.length) | 0;
    const a = active[aidx];
    let found = false;
    for (let t = 0; t < k; t++) {
      const ang = rng() * Math.PI * 2;
      const rad = r * (1 + rng());
      const x = a.x + Math.cos(ang) * rad;
      const y = a.y + Math.sin(ang) * rad;
      if (x < r || y < r || x > width - r || y > height - r) continue;
      if (!pointInPoly(x, y, pts)) continue;
      if (farEnough(x, y)) {
        samples.push({ x, y });
        active.push({ x, y });
        grid[gridIdx(x, y)] = samples.length - 1;
        found = true;
        break;
      }
    }
    if (!found) {
      active.splice(aidx, 1);
    }
  }

  return samples;
}
