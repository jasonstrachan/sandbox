import { vec2 } from '../math/vec2.js';
import { createSpawnArtifact } from '../mesh/spawn.js';
import { getMaterialProfile } from '../core/materials.js';
import { Xoshiro128 } from '../rng/xoshiro128.js';

export function instantiateArtifact(spawnParams, options = {}) {
  const rng = options.rng ?? new Xoshiro128(spawnParams.seed ?? 'artifact');
  const spawn = options.spawn ?? createSpawnArtifact(spawnParams, rng);
  const material = cloneMaterial(options.material ?? getMaterialProfile(spawn.shapeId));

  const particleCount = spawn.particles.length || 1;
  const areaEstimate = Math.max(spawn.dims.width * spawn.dims.height, 1);
  const totalMass = areaEstimate * material.density;
  const massPerParticle = totalMass / particleCount;
  const invMass = massPerParticle > 0 ? 1 / massPerParticle : 0;
  const spacingX = spawn.diagnostics?.spacingX ?? 16;
  const spacingY = spawn.diagnostics?.spacingY ?? 16;
  const particleRadius = Math.max(Math.min(spacingX, spacingY) * 0.35, 3);

  const particles = spawn.particles.map((particle) => {
    const position = { ...particle.position };
    return {
      id: particle.id,
      row: particle.row,
      col: particle.col,
      local: { ...particle.local },
      position,
      prevPosition: { ...position },
      velocity: vec2(0, 0),
      invMass,
      mass: massPerParticle,
      pinned: particle.pinned || false,
      boundary: particle.boundary || false,
      radius: particle.radius ?? particleRadius,
    };
  });

  const stretchCount = spawn.topology.stretch.length + spawn.topology.shear.length;
  const areaCount = spawn.topology.areas.length;
  const bendCount = spawn.topology.bends.length;

  return {
    id: spawn.id,
    shapeId: spawn.shapeId,
    spawn,
    particles,
    topology: spawn.topology,
    material,
    state: 'active',
    age: 0,
    tier: 'active',
    opacity: 1,
    nextUpdateFrame: 0,
    plasticStrain: 0,
    debug: {
      stretchResiduals: new Float32Array(stretchCount),
      areaResiduals: new Float32Array(areaCount),
      bendResiduals: new Float32Array(bendCount),
    },
  };
}

function cloneMaterial(profile) {
  return {
    ...profile,
    compliance: { ...profile.compliance },
    friction: { ...profile.friction },
    plastic: { ...profile.plastic },
    damping: { ...profile.damping },
  };
}
