/** @typedef {import('./types.js').StratifiedPRNG} StratifiedPRNG */
/** @typedef {import('./types.js').MaterialPreset} MaterialPreset */
/** @typedef {import('./types.js').ArtifactClass} ArtifactClass */
/** @typedef {import('./types.js').ArtifactDescriptor} ArtifactDescriptor */
/** @typedef {import('./types.js').ArtifactSpawnOptions} ArtifactSpawnOptions */
/** @typedef {import('./types.js').ArtifactParamDefs} ArtifactParamDefs */
/** @typedef {import('./types.js').ArtifactParamValues} ArtifactParamValues */
/** @type {{ STRUCT: 0, SHEAR: 1, BEND: 2, CREASE: 3 }} */
const EDGE_CONSTRAINT_TYPE = {
  STRUCT: 0,
  SHEAR: 1,
  BEND: 2,
  CREASE: 3,
};

/** @type {Record<string, MaterialPreset>} */
export const MATERIAL_PRESETS = {
  paperboard: {
    id: 'paperboard',
    name: 'Paperboard Carton',
    density: 0.72, // g/cm^3
    stretch: 0.48,
    bend: 0.32,
    shear: 0.26,
    damping: 0.72,
    friction: 0.46,
    restitution: 0.12,
    plasticity: 0.18,
    smearCoeff: 0.65,
  },
  wrapper: {
    id: 'wrapper',
    name: 'Film Wrapper',
    density: 0.38,
    stretch: 0.32,
    bend: 0.08,
    shear: 0.28,
    damping: 0.84,
    friction: 0.58,
    restitution: 0.05,
    plasticity: 0.42,
    smearCoeff: 0.82,
  },
  coin: {
    id: 'coin',
    name: 'Token / Coin',
    density: 2.4,
    stretch: 0.92,
    bend: 0.88,
    shear: 0.8,
    damping: 0.35,
    friction: 0.22,
    restitution: 0.16,
    plasticity: 0.04,
    smearCoeff: 0.21,
  },
};

/** @type {ArtifactClass[]} */
export const ARTIFACT_CLASSES = [
  {
    id: 'circle',
    title: 'Circle Disc',
    builder: 'circle',
    materialId: 'coin',
    weight: 1,
    params: {
      radius: [0.02, 0.04],
      thickness: [0.0008, 0.0015],
      segments: { range: [96, 180], type: 'int' },
    },
    constraintProfile: {
      structuralMultiplier: 1.4,
    },
  },
  {
    id: 'box',
    title: 'Box / Carton',
    builder: 'box',
    materialId: 'paperboard',
    weight: 0.42,
    params: {
      width: [0.06, 0.3],
      depth: [0.04, 0.22],
      height: [0.08, 0.38],
      thickness: [0.0015, 0.0045],
      bevel: [0, 0.012],
      dent: [0, 0.18],
    },
    constraintProfile: {
      structuralMultiplier: 1,
      creaseMultiplier: 1.2,
    },
  },
  {
    id: 'wrapper',
    title: 'Wrapper / Film',
    builder: 'wrapper',
    materialId: 'wrapper',
    weight: 0.36,
    params: {
      width: [0.08, 0.26],
      height: [0.12, 0.32],
      slack: [0.02, 0.12],
      segmentsX: { range: [10, 22], type: 'int' },
      segmentsY: { range: [12, 26], type: 'int' },
      crinkle: [0.1, 0.65],
    },
    constraintProfile: {
      structuralMultiplier: 0.8,
      shearMultiplier: 0.55,
      bendMultiplier: 0.24,
    },
  },
  {
    id: 'coin',
    title: 'Coin / Token',
    builder: 'coin',
    materialId: 'coin',
    weight: 0.22,
    params: {
      radius: [0.015, 0.04],
      thickness: [0.001, 0.004],
      segments: { range: [18, 42], type: 'int' },
      lipHeight: [0.0005, 0.0015],
    },
    constraintProfile: {
      structuralMultiplier: 1.8,
    },
  },
];

/**
 * @param {StratifiedPRNG} prng
 * @param {Record<string, number>} [weights]
 * @returns {ArtifactClass}
 */
export function pickArtifactClass(prng, weights) {
  const entries = (weights && Object.keys(weights).length
    ? ARTIFACT_CLASSES.map((cls) => ({ ...cls, weight: weights[cls.id] ?? 0 }))
    : ARTIFACT_CLASSES
  ).filter((cls) => cls.weight > 0);

  if (!entries.length) throw new Error('No artifact class weights supplied');

  const total = entries.reduce((sum, cls) => sum + cls.weight, 0);
  const r = prng.nextFloat() * total;
  let acc = 0;
  for (const cls of entries) {
    acc += cls.weight;
    if (r <= acc) return cls;
  }
  return entries[entries.length - 1];
}

/**
 * @param {ArtifactClass} cls
 * @param {StratifiedPRNG} prng
 * @param {Record<string, number>} [overrides]
 * @returns {ArtifactParamValues}
 */
export function sampleArtifactParams(cls, prng, overrides = {}) {
  /** @type {ArtifactParamValues} */
  const result = {};
  for (const [key, def] of Object.entries(cls.params || {})) {
    if (overrides[key] !== undefined) {
      result[key] = overrides[key];
      continue;
    }
    result[key] = sampleValue(def, prng);
  }
  return result;
}

/**
 * @param {StratifiedPRNG} prng
 * @param {ArtifactSpawnOptions} [options]
 * @returns {ArtifactDescriptor}
 */
export function createArtifactDescriptor(prng, { weights, overrides, classId } = {}) {
  const cls = classId
    ? ARTIFACT_CLASSES.find((entry) => entry.id === classId)
    : pickArtifactClass(prng, weights);
  if (!cls) throw new Error(`Unknown artifact class: ${classId}`);
  const params = sampleArtifactParams(cls, prng, overrides);
  return {
    id: `${cls.id}-${Math.floor(prng.nextBetween(0, 1e9)).toString(36)}`,
    classId: cls.id,
    builder: cls.builder,
    material: MATERIAL_PRESETS[cls.materialId],
    params,
    constraintProfile: cls.constraintProfile,
  };
}

export { EDGE_CONSTRAINT_TYPE };

function sampleValue(def, prng) {
  if (Array.isArray(def)) {
    return lerpRange(def[0], def[1], prng);
  }
  if (typeof def === 'object' && def !== null) {
    const [min, max] = def.range || [def.min ?? 0, def.max ?? 1];
    let value = lerpRange(min, max, prng);
    if (def.step) {
      const step = Number(def.step);
      if (step > 0) value = Math.round(value / step) * step;
    }
    if (def.type === 'int') {
      value = Math.round(value);
    }
    if (typeof def.transform === 'function') {
      value = def.transform(value, prng);
    }
    return value;
  }
  return Number(def ?? 0);
}

function lerpRange(min, max, prng) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return min ?? max ?? 0;
  if (max === min) return min;
  return prng.nextBetween(Math.min(min, max), Math.max(min, max));
}
