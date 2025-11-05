/**
 * Object factory for generating procedural artifact meshes
 * Each object type has specific deformation properties
 */

import { SeededRandom } from '../utils/seeded-random.js';

export const ObjectClass = {
  BOX: 'box',
  BOTTLE: 'bottle',
  WRAPPER: 'wrapper',
  TAG: 'tag',
  COIN: 'coin',
};

export const MaterialPresets = {
  [ObjectClass.BOX]: {
    density: 0.7,        // g/cm³ (paperboard)
    stiffness: 0.8,
    damping: 0.95,
    friction: 0.6,
    restitution: 0.1,
    smearCoeff: 0.7,
  },
  [ObjectClass.BOTTLE]: {
    density: 1.0,        // g/cm³ (plastic)
    stiffness: 0.6,
    damping: 0.92,
    friction: 0.4,
    restitution: 0.2,
    smearCoeff: 0.4,
  },
  [ObjectClass.WRAPPER]: {
    density: 0.3,        // g/cm³ (thin plastic/paper)
    stiffness: 0.3,
    damping: 0.98,
    friction: 0.8,
    restitution: 0.05,
    smearCoeff: 0.9,
  },
  [ObjectClass.TAG]: {
    density: 0.5,        // g/cm³ (paper)
    stiffness: 0.5,
    damping: 0.96,
    friction: 0.7,
    restitution: 0.08,
    smearCoeff: 0.8,
  },
  [ObjectClass.COIN]: {
    density: 5.0,        // g/cm³ (metal)
    stiffness: 0.95,
    damping: 0.85,
    friction: 0.5,
    restitution: 0.4,
    smearCoeff: 0.3,
  },
};

/**
 * Generate a box mesh with beveled edges and crease lines
 */
function generateBox(rng, params) {
  const { width, height, depth } = params;
  const bevel = 0.1;

  // Simple box as 8 vertices (we'll keep it simple for the prototype)
  const hw = width / 2;
  const hh = height / 2;
  const hd = depth / 2;

  const positions = new Float32Array([
    // Front face
    -hw, -hh, hd,   hw, -hh, hd,   hw, hh, hd,   -hw, hh, hd,
    // Back face
    -hw, -hh, -hd,  hw, -hh, -hd,  hw, hh, -hd,  -hw, hh, -hd,
  ]);

  const indices = new Uint32Array([
    // Front
    0, 1, 2,  0, 2, 3,
    // Right
    1, 5, 6,  1, 6, 2,
    // Back
    5, 4, 7,  5, 7, 6,
    // Left
    4, 0, 3,  4, 3, 7,
    // Top
    3, 2, 6,  3, 6, 7,
    // Bottom
    4, 5, 1,  4, 1, 0,
  ]);

  // Crease edges (pairs of vertex indices that can bend)
  const creases = new Uint32Array([
    // Vertical edges
    0, 4,  1, 5,  2, 6,  3, 7,
    // Horizontal edges (top/bottom)
    0, 1,  1, 2,  2, 3,  3, 0,
    4, 5,  5, 6,  6, 7,  7, 4,
  ]);

  return { positions, indices, creases };
}

/**
 * Generate a cylindrical bottle/can mesh
 */
function generateBottle(rng, params) {
  const { radius, height, segments } = params;
  const positions = [];
  const indices = [];

  // Bottom cap center
  positions.push(0, 0, 0);

  // Bottom ring
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    positions.push(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius
    );
  }

  // Top ring
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    positions.push(
      Math.cos(angle) * radius,
      height,
      Math.sin(angle) * radius
    );
  }

  // Top cap center
  positions.push(0, height, 0);

  // Build indices for bottom cap
  for (let i = 0; i < segments; i++) {
    indices.push(0, i + 1, ((i + 1) % segments) + 1);
  }

  // Build indices for cylinder sides
  for (let i = 0; i < segments; i++) {
    const curr = i + 1;
    const next = ((i + 1) % segments) + 1;
    const currTop = i + 1 + segments;
    const nextTop = ((i + 1) % segments) + 1 + segments;

    indices.push(curr, currTop, next);
    indices.push(next, currTop, nextTop);
  }

  // Build indices for top cap
  const topCenter = positions.length / 3 - 1;
  for (let i = 0; i < segments; i++) {
    const curr = i + 1 + segments;
    const next = ((i + 1) % segments) + 1 + segments;
    indices.push(topCenter, next, curr);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    creases: new Uint32Array([]), // Bottles have uniform deformation
  };
}

/**
 * Generate a simple rectangular tag/label
 */
function generateTag(rng, params) {
  const { width, height } = params;
  const hw = width / 2;
  const hh = height / 2;

  const positions = new Float32Array([
    -hw, -hh, 0,
    hw, -hh, 0,
    hw, hh, 0,
    -hw, hh, 0,
  ]);

  const indices = new Uint32Array([
    0, 1, 2,
    0, 2, 3,
  ]);

  // Tags can bend along edges
  const creases = new Uint32Array([
    0, 1,  1, 2,  2, 3,  3, 0,
  ]);

  return { positions, indices, creases };
}

/**
 * Main factory function to create artifacts
 */
export function createArtifact(seed, objectClass = null) {
  const rng = new SeededRandom(seed);

  // Choose object class if not specified
  if (!objectClass) {
    objectClass = rng.choice([
      ObjectClass.BOX,
      ObjectClass.BOX,      // More common
      ObjectClass.BOTTLE,
      ObjectClass.TAG,
      ObjectClass.WRAPPER,
      ObjectClass.COIN,
    ]);
  }

  const material = MaterialPresets[objectClass];

  let mesh;
  let params;

  switch (objectClass) {
    case ObjectClass.BOX:
      params = {
        width: rng.range(6, 20),
        height: rng.range(6, 20),
        depth: rng.range(3, 10),
      };
      mesh = generateBox(rng, params);
      break;

    case ObjectClass.BOTTLE:
      params = {
        radius: rng.range(2, 5),
        height: rng.range(10, 25),
        segments: 12,
      };
      mesh = generateBottle(rng, params);
      break;

    case ObjectClass.TAG:
      params = {
        width: rng.range(4, 12),
        height: rng.range(6, 15),
      };
      mesh = generateTag(rng, params);
      break;

    case ObjectClass.WRAPPER:
      // Similar to tag but thinner
      params = {
        width: rng.range(8, 20),
        height: rng.range(8, 20),
      };
      mesh = generateTag(rng, params);
      break;

    case ObjectClass.COIN:
      params = {
        radius: rng.range(1, 2.5),
        height: 0.3,
        segments: 16,
      };
      mesh = generateBottle(rng, params);
      break;
  }

  // Generate random color in desaturated palette
  const hue = rng.random() * 360;
  const saturation = rng.range(0.1, 0.3);
  const lightness = rng.range(0.3, 0.7);

  return {
    class: objectClass,
    material,
    mesh,
    params,
    color: { h: hue, s: saturation, l: lightness },
    spawnX: rng.range(-40, 40), // cm from center
    spawnY: 100, // cm above ground
    rotation: rng.random() * Math.PI * 2,
    angularVel: rng.range(-0.5, 0.5),
  };
}
