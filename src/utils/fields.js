import { bbox, distanceToPolygon } from './geometry.js';

export function buildSDF(step, pts, width, height) {
  const bb = bbox(pts);
  const margin = 12;
  const minx = Math.max(0, Math.floor((bb.minx - margin) / step) * step);
  const miny = Math.max(0, Math.floor((bb.miny - margin) / step) * step);
  const maxx = Math.min(width, Math.ceil((bb.maxx + margin) / step) * step);
  const maxy = Math.min(height, Math.ceil((bb.maxy + margin) / step) * step);
  const nx = Math.floor((maxx - minx) / step) + 1;
  const ny = Math.floor((maxy - miny) / step) + 1;
  const field = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minx + i * step;
      const y = miny + j * step;
      field[j * nx + i] = distanceToPolygon(x, y, pts);
    }
  }
  return { minx, miny, maxx, maxy, nx, ny, step, field };
}

export function gradientField(nx, ny, step, field) {
  const gx = new Float32Array(nx * ny);
  const gy = new Float32Array(nx * ny);
  const at = (i, j) => field[j * nx + i];
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const idx = j * nx + i;
      gx[idx] = (at(i + 1, j) - at(i - 1, j)) / (2 * step);
      gy[idx] = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
    }
  }
  return { gx, gy };
}

export function bilinearGrad(minx, miny, step, nx, ny, gx, gy) {
  return function sample(x, y) {
    const fx = (x - minx) / step;
    const fy = (y - miny) / step;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) return { gx: 0, gy: 0 };
    const tx = fx - i;
    const ty = fy - j;
    const i0 = j * nx + i;
    const i1 = i0 + 1;
    const i2 = i0 + nx;
    const i3 = i2 + 1;
    return {
      gx:
        gx[i0] * (1 - tx) * (1 - ty) +
        gx[i1] * tx * (1 - ty) +
        gx[i2] * (1 - tx) * ty +
        gx[i3] * tx * ty,
      gy:
        gy[i0] * (1 - tx) * (1 - ty) +
        gy[i1] * tx * (1 - ty) +
        gy[i2] * (1 - tx) * ty +
        gy[i3] * tx * ty,
    };
  };
}

export function bilinearScalar(minx, miny, step, nx, ny, field) {
  return function sample(x, y) {
    const fx = (x - minx) / step;
    const fy = (y - miny) / step;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) return 0;
    const tx = fx - i;
    const ty = fy - j;
    const i0 = j * nx + i;
    const i1 = i0 + 1;
    const i2 = i0 + nx;
    const i3 = i2 + 1;
    return (
      field[i0] * (1 - tx) * (1 - ty) +
      field[i1] * tx * (1 - ty) +
      field[i2] * (1 - tx) * ty +
      field[i3] * tx * ty
    );
  };
}

export function march(minx, miny, step, nx, ny, field, iso, cb) {
  function v(i, j) {
    return field[j * nx + i] - iso;
  }
  function ip(ax, ay, bx, by, va, vb) {
    const t = va / (va - vb + 1e-12);
    return { x: ax + t * (bx - ax), y: ay + t * (by - ay) };
  }
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const x = minx + i * step;
      const y = miny + j * step;
      const vTL = v(i, j);
      const vTR = v(i + 1, j);
      const vBR = v(i + 1, j + 1);
      const vBL = v(i, j + 1);
      let idx = 0;
      if (vTL > 0) idx |= 1;
      if (vTR > 0) idx |= 2;
      if (vBR > 0) idx |= 4;
      if (vBL > 0) idx |= 8;
      if (idx === 0 || idx === 15) continue;
      const pTop = ip(x, y, x + step, y, vTL, vTR);
      const pRight = ip(x + step, y, x + step, y + step, vTR, vBR);
      const pBottom = ip(x, y + step, x + step, y + step, vBL, vBR);
      const pLeft = ip(x, y, x, y + step, vTL, vBL);
      switch (idx) {
        case 1:
        case 14:
          cb(pLeft, pTop);
          break;
        case 2:
        case 13:
          cb(pTop, pRight);
          break;
        case 3:
        case 12:
          cb(pLeft, pRight);
          break;
        case 4:
        case 11:
          cb(pRight, pBottom);
          break;
        case 5:
          cb(pLeft, pTop);
          cb(pRight, pBottom);
          break;
        case 6:
        case 9:
          cb(pTop, pBottom);
          break;
        case 7:
        case 8:
          cb(pLeft, pBottom);
          break;
        case 10:
          cb(pLeft, pBottom);
          cb(pTop, pRight);
          break;
        default:
          break;
      }
    }
  }
}
