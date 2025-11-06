/**
 * @typedef {Object} ArtifactStateField
 * @property {string} name
 * @property {'u32' | 'vec4f'} type
 * @property {number} components
 * @property {boolean} [atomic]
 */

/** @type {ArtifactStateField[]} */
const FIELDS = [
  { name: 'totalImpulse', type: 'u32', components: 1, atomic: true },
  { name: 'contactCount', type: 'u32', components: 1, atomic: true },
  { name: 'maxSpeed', type: 'u32', components: 1, atomic: true },
  { name: 'padAtomic', type: 'u32', components: 1 },
  { name: 'restFrames', type: 'u32', components: 1 },
  { name: 'flags', type: 'u32', components: 1 },
  { name: 'materialId', type: 'u32', components: 1 },
  { name: 'vertexCount', type: 'u32', components: 1 },
  { name: 'materialParams', type: 'vec4f', components: 4 },
];

/** @type {Record<string, number>} */
const offsets = {};
let scalarCursor = 0;
for (const field of FIELDS) {
  offsets[field.name] = scalarCursor;
  scalarCursor += field.components;
}

export const ARTIFACT_STATE_LAYOUT = FIELDS;
export const ARTIFACT_STATE_OFFSETS = /** @type {Record<string, number>} */ (Object.freeze({ ...offsets }));
export const ARTIFACT_STATE_STRIDE = scalarCursor;
export const ARTIFACT_STATE_SIZE = ARTIFACT_STATE_STRIDE * 4;

/**
 * @typedef {Object} ArtifactMaterialParams
 * @property {number} [friction]
 * @property {number} [restitution]
 * @property {number} [damping]
 * @property {number} [smearCoeff]
 */

const DEFAULT_MATERIAL = Object.freeze({
  friction: 0.5,
  restitution: 0.08,
  damping: 0.9,
  smearCoeff: 0.5,
});

/**
 * @param {ArrayBuffer} buffer
 * @param {number} index
 * @param {{ materialId?: number; vertexCount?: number; material?: ArtifactMaterialParams }} [options]
 */
export function writeArtifactStateEntry(buffer, index, { materialId = 0, vertexCount = 0, material = {} } = {}) {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new TypeError('Artifact state buffer must be an ArrayBuffer');
  }
  const uint = new Uint32Array(buffer);
  const float = new Float32Array(buffer);
  const base = index * ARTIFACT_STATE_STRIDE;
  if (base + ARTIFACT_STATE_STRIDE > uint.length) {
    throw new RangeError('Artifact state index out of bounds');
  }
  const mat = material || DEFAULT_MATERIAL;
  uint[base + ARTIFACT_STATE_OFFSETS.materialId] = materialId;
  uint[base + ARTIFACT_STATE_OFFSETS.vertexCount] = vertexCount;
  const paramsOffset = ARTIFACT_STATE_OFFSETS.materialParams;
  float[base + paramsOffset + 0] = mat.friction ?? DEFAULT_MATERIAL.friction;
  float[base + paramsOffset + 1] = mat.restitution ?? DEFAULT_MATERIAL.restitution;
  float[base + paramsOffset + 2] = mat.damping ?? DEFAULT_MATERIAL.damping;
  float[base + paramsOffset + 3] = mat.smearCoeff ?? DEFAULT_MATERIAL.smearCoeff;
  uint[base + ARTIFACT_STATE_OFFSETS.restFrames] = 0;
  uint[base + ARTIFACT_STATE_OFFSETS.flags] = 0;
}

export function createArtifactStateBuffer(count = 1) {
  const clamped = Math.max(1, Math.floor(count));
  return new ArrayBuffer(clamped * ARTIFACT_STATE_SIZE);
}

/**
 * @param {string} [structName]
 */
export function createArtifactStateStructWGSL(structName = 'ArtifactState') {
  const lines = FIELDS.map((field) => {
    const type = field.atomic ? `atomic<${field.type}>` : field.type;
    return `  ${field.name} : ${type},`;
  });
  return `struct ${structName} {\n${lines.join('\n')}\n};`;
}

export const ARTIFACT_STATE_STRUCT_WGSL = createArtifactStateStructWGSL();
