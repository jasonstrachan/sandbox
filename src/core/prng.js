const MASK_64 = (1n << 64n) - 1n;
const TAU = 0x9e3779b97f4a7c15n;
const DOUBLE_SCALE = 2 ** 53;

/**
 * @param {string | number | bigint} seedInput
 */
export function createPRNG(seedInput = Date.now()) {
  let state = initState(seedInput);

  const nextRaw = () => {
    const { result, s0, s1 } = xoroshiro128plusStep(state.s0, state.s1);
    state = { s0, s1, seed: state.seed };
    return result;
  };

  return {
    get seed() {
      return state.seed;
    },
    setSeed(value) {
      state = initState(value);
    },
    nextFloat() {
      const raw = nextRaw();
      return Number(raw >> 11n) / DOUBLE_SCALE;
    },
    nextInt(max = 0xffffffff) {
      const bound = Math.max(0, Math.floor(max));
      if (!Number.isFinite(bound) || bound === 0) return 0;
      const raw = Number(nextRaw() & 0xffffffffn);
      return raw % (bound + 1);
    },
    nextBetween(min = 0, max = 1) {
      return min + (max - min) * this.nextFloat();
    },
    random() {
      return this.nextFloat();
    },
    shuffle(array) {
      const clone = array.slice();
      for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.nextFloat() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
      }
      return clone;
    },
    sample(array) {
      if (!array?.length) return undefined;
      const index = Math.floor(this.nextFloat() * array.length);
      return array[index];
    },
    serialize() {
      return { seed: state.seed };
    },
  };
}

export function hashSeed(input) {
  const str = String(input ?? '');
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (BigInt(h2 >>> 0) << 32n) | BigInt(h1 >>> 0);
}

/**
 * @param {string | number | bigint} seedInput
 */
function initState(seedInput) {
  let hashed = (hashSeed(seedInput) + TAU) & MASK_64;
  const s0 = splitMix64(hashed);
  hashed = (hashed + TAU) & MASK_64;
  const s1 = splitMix64(hashed);
  return { s0, s1, seed: normalizeSeed(seedInput) };
}

/**
 * @param {bigint} value
 */
function splitMix64(value) {
  let z = (value + TAU) & MASK_64;
  z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n & MASK_64;
  z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn & MASK_64;
  return z ^ (z >> 31n);
}

/**
 * @param {bigint} s0
 * @param {bigint} s1
 */
function xoroshiro128plusStep(s0, s1) {
  const result = (s0 + s1) & MASK_64;
  let newS1 = s1 ^ s0;
  const newS0 = rotl(s0, 55n) ^ newS1 ^ ((newS1 << 14n) & MASK_64);
  newS1 = rotl(newS1, 36n);
  return { result, s0: newS0 & MASK_64, s1: newS1 & MASK_64 };
}

/**
 * @param {bigint} x
 * @param {bigint} k
 */
function rotl(x, k) {
  return ((x << k) & MASK_64) | (x >> (64n - k));
}

function normalizeSeed(seed) {
  if (typeof seed === 'string') return seed;
  if (typeof seed === 'number') return seed.toString(10);
  if (typeof seed === 'bigint') return seed.toString();
  return JSON.stringify(seed ?? '');
}
