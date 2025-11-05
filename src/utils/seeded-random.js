/**
 * xoroshiro128+ seeded random number generator
 * Provides deterministic, high-quality random numbers
 */

export class SeededRandom {
  constructor(seed) {
    this.state = new BigUint64Array(2);
    this.seed(seed);
  }

  seed(seed) {
    // Initialize state from seed string
    let hash = 0n;
    if (typeof seed === 'string') {
      for (let i = 0; i < seed.length; i++) {
        hash = (hash << 5n) - hash + BigInt(seed.charCodeAt(i));
        hash = hash & hash; // Convert to 32bit integer
      }
    } else {
      hash = BigInt(seed);
    }

    // Use splitmix64 to initialize state
    this.state[0] = this.splitmix64(hash);
    this.state[1] = this.splitmix64(this.state[0]);
  }

  splitmix64(x) {
    x = (x ^ (x >> 30n)) * 0x9e3779b97f4a7c15n;
    x = (x ^ (x >> 27n)) * 0x94d049bb133111ebn;
    return x ^ (x >> 31n);
  }

  // xoroshiro128+ algorithm
  next() {
    const s0 = this.state[0];
    let s1 = this.state[1];
    const result = s0 + s1;

    s1 ^= s0;
    this.state[0] = this.rotl(s0, 24n) ^ s1 ^ (s1 << 16n);
    this.state[1] = this.rotl(s1, 37n);

    return result;
  }

  rotl(x, k) {
    return (x << k) | (x >> (64n - k));
  }

  // Return float in [0, 1)
  random() {
    const value = this.next();
    // Convert to float between 0 and 1
    return Number(value & 0xfffffffffffffn) / 0x10000000000000;
  }

  // Return float in [min, max)
  range(min, max) {
    return min + this.random() * (max - min);
  }

  // Return integer in [min, max]
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  // Return random choice from array
  choice(array) {
    return array[this.int(0, array.length - 1)];
  }

  // Return random boolean
  bool(probability = 0.5) {
    return this.random() < probability;
  }

  // Hash function for GPU shaders
  static glslHash() {
    return `
// Hash functions for deterministic randomness in shaders
uint hash1(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

uint hash2(uvec2 v) {
  return hash1(v.x ^ hash1(v.y));
}

uint hash3(uvec3 v) {
  return hash1(v.x ^ hash1(v.y) ^ hash1(v.z));
}

float randomFloat(uint seed) {
  return float(hash1(seed)) / 4294967295.0;
}

vec2 randomVec2(uint seed) {
  uint h = hash1(seed);
  return vec2(
    float(h) / 4294967295.0,
    float(hash1(h)) / 4294967295.0
  );
}
`;
  }
}
