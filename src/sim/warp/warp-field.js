import { Xoshiro128 } from '../rng/xoshiro128.js';

export class WarpField {
  constructor({ width = 1024, height = 768, seed = 'warp', gridResolution = 6 } = {}) {
    this.gridResolution = gridResolution;
    this.rng = new Xoshiro128(seed);
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const span = Math.min(this.width, this.height);
    this.amplitude = span * 0.04;
    this.generateControlGrid();
  }

  generateControlGrid() {
    const size = this.gridResolution + 1;
    this.control = Array.from({ length: size }, () => Array(size).fill(null));
    for (let y = 0; y <= this.gridResolution; y += 1) {
      for (let x = 0; x <= this.gridResolution; x += 1) {
        this.control[y][x] = {
          dx: (this.rng.nextFloat() - 0.5) * this.amplitude,
          dy: (this.rng.nextFloat() - 0.5) * this.amplitude,
        };
      }
    }
  }

  sample(x, y) {
    const u = clamp01(x / this.width);
    const v = clamp01(y / this.height);
    const gx = u * this.gridResolution;
    const gy = v * this.gridResolution;
    const ix = Math.min(this.gridResolution - 1, Math.floor(gx));
    const iy = Math.min(this.gridResolution - 1, Math.floor(gy));
    const tx = gx - ix;
    const ty = gy - iy;
    const c00 = this.control[iy][ix];
    const c10 = this.control[iy][ix + 1];
    const c01 = this.control[iy + 1][ix];
    const c11 = this.control[iy + 1][ix + 1];
    const dx = bilerp(c00.dx, c10.dx, c01.dx, c11.dx, tx, ty);
    const dy = bilerp(c00.dy, c10.dy, c01.dy, c11.dy, tx, ty);
    return { x: x + dx, y: y + dy };
  }

  displacement(x, y) {
    const projected = this.sample(x, y);
    return { dx: projected.x - x, dy: projected.y - y };
  }

  vectorField(samples = 8) {
    const vectors = [];
    for (let row = 0; row <= samples; row += 1) {
      for (let col = 0; col <= samples; col += 1) {
        const x = (col / samples) * this.width;
        const y = (row / samples) * this.height;
        const d = this.displacement(x, y);
        vectors.push({ x, y, dx: d.dx, dy: d.dy });
      }
    }
    return vectors;
  }
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function bilerp(c00, c10, c01, c11, tx, ty) {
  const a = c00 + (c10 - c00) * tx;
  const b = c01 + (c11 - c01) * tx;
  return a + (b - a) * ty;
}
