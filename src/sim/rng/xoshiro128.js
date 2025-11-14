const UINT32_MAX = 0xffffffff;

export class Xoshiro128 {
  constructor(seed = 1) {
    this.state = new Uint32Array(4);
    this.setSeed(seed);
  }

  setSeed(seed) {
    const normalized = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    let x = normalized || 1;
    for (let i = 0; i < 4; i += 1) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.state[i] = x >>> 0;
    }
    if (!this.state.some(Boolean)) {
      this.state[0] = 0x9e3779b9;
    }
  }

  clone() {
    const next = new Xoshiro128();
    next.state.set(this.state);
    return next;
  }

  nextUint() {
    const s = this.state;
    const result = rotl(s[1] * 5, 7) * 9;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    this.state = s;
    return result >>> 0;
  }

  nextFloat() {
    return this.nextUint() / (UINT32_MAX + 1);
  }

  nextRange(min = 0, max = 1) {
    return min + (max - min) * this.nextFloat();
  }

  nextInt(bound) {
    return Math.floor(this.nextFloat() * bound);
  }
}

function rotl(value, shift) {
  return (value << shift) | (value >>> (32 - shift));
}

function hashString(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
