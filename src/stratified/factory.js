/** @typedef {import('./types.js').StratifiedPRNG} StratifiedPRNG */
/** @typedef {import('./types.js').ArtifactRecord} ArtifactRecord */
/** @typedef {import('./types.js').ArtifactSpawnOptions} ArtifactSpawnOptions */
/** @typedef {import('./types.js').SimulationPoolConfig} SimulationPoolConfig */

import { createArtifactDescriptor } from './definitions.js';
import { MeshBuilders } from './mesh-builders.js';
import { createArtifactStagingBuffers } from './staging-buffers.js';

/**
 * @param {{ prng?: StratifiedPRNG, poolConfig?: SimulationPoolConfig }} [options]
 */
export function createArtifactFactory({ prng, poolConfig } = {}) {
  if (!prng) throw new Error('Artifact factory requires a PRNG instance');
  const prngInstance = prng;
  const staging = createArtifactStagingBuffers(poolConfig);
  /** @type {ArtifactRecord[]} */
  const artifacts = [];

  /**
   * @param {ArtifactSpawnOptions} [options]
   * @returns {ArtifactRecord}
   */
  function spawn(options = {}) {
    const descriptor = createArtifactDescriptor(prngInstance, options);
    const builder = MeshBuilders[descriptor.builder];
    if (!builder) throw new Error(`No mesh builder registered for ${descriptor.builder}`);
    const payload = builder(descriptor.params, { material: descriptor.material, prng: prngInstance });
    const record = staging.writeArtifact({ ...payload, descriptor });
    const enriched = { descriptor, ranges: record, payload };
    artifacts.push(enriched);
    return enriched;
  }

  return {
    staging,
    spawn,
    artifacts,
    reset() {
      artifacts.splice(0, artifacts.length);
      staging.reset();
    },
  };
}
