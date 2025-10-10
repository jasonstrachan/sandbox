class RNG {
  constructor(seed) {
    this.s = seed | 0;
  }

  next() {
    this.s = (1664525 * this.s + 1013904223) | 0;
    return (this.s >>> 0) / 4294967296;
  }
}

export class Perlin {
  constructor(seed) {
    const rng = new RNG(seed);
    const p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rng.next() * (i + 1)) | 0;
      const t = perm[i];
      perm[i] = perm[j];
      perm[j] = t;
    }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const grad2 = [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    function fade(t) {
      return t * t * t * (t * (t * 6 - 15) + 10);
    }

    function lerp(a, b, t) {
      return a + t * (b - a);
    }

    function dot(gx, gy, x, y) {
      return gx * x + gy * y;
    }

    function noise2(x, y) {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      const xf = x - Math.floor(x);
      const yf = y - Math.floor(y);
      const u = fade(xf);
      const v = fade(yf);
      const aa = p[X + p[Y]];
      const ab = p[X + p[Y + 1]];
      const ba = p[X + 1 + p[Y]];
      const bb = p[X + 1 + p[Y + 1]];
      const gAA = grad2[aa & 7];
      const gBA = grad2[ba & 7];
      const gAB = grad2[ab & 7];
      const gBB = grad2[bb & 7];
      const x1 = lerp(dot(gAA[0], gAA[1], xf, yf), dot(gBA[0], gBA[1], xf - 1, yf), u);
      const x2 = lerp(dot(gAB[0], gAB[1], xf, yf - 1), dot(gBB[0], gBB[1], xf - 1, yf - 1), u);
      return lerp(x1, x2, v);
    }

    this.fbm2 = function (x, y, oct = 3) {
      let amp = 1;
      let freq = 1;
      let sum = 0;
      let norm = 0;
      for (let i = 0; i < oct; i++) {
        sum += amp * noise2(x * freq, y * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
      }
      return sum / (norm || 1);
    };
  }
}
