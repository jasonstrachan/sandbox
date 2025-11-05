const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function hashString(input = '') {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i) & 0xff;
    hash = (hash * FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
