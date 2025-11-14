export const MATERIAL_PROFILES = {
  default: material({ baseHue: 0.08 }),
  'box-carton': material({ density: 0.8, stretch: 2e-4, area: 5e-4, baseHue: 0.08 }),
  'flat-mailer': material({ density: 0.6, stretch: 1.8e-4, area: 4e-4, baseHue: 0.03 }),
  'bottle-profile': material({ density: 1, stretch: 1e-4, area: 2e-4, baseHue: 0.55 }),
  'phone-slab': material({ density: 1.4, stretch: 8e-5, area: 1.6e-4, baseHue: 0.66 }),
  'irregular-shard': material({ density: 0.7, stretch: 1.6e-4, area: 4e-4, baseHue: 0 }),
  'handbag-tote': material({ density: 0.5, stretch: 3e-4, area: 6e-4, baseHue: 0.92 }),
  'bicycle-chunk': material({ density: 1.2, stretch: 9e-5, area: 2e-4, baseHue: 0.58 }),
  'bicycle-frame': material({ density: 1.5, stretch: 4e-5, area: 9e-5, baseHue: 0.62, velocityDamping: 4, writebackDamping: 0.08 }),
  'skull-icon': material({ density: 1.05, stretch: 1.4e-4, area: 2.4e-4, baseHue: 0.15 }),
};

export function getMaterialProfile(shapeId) {
  return MATERIAL_PROFILES[shapeId] ?? MATERIAL_PROFILES.default;
}

function material({
  density = 1,
  stretch = 1.5e-4,
  area = 3e-4,
  baseHue = 0,
  velocityDamping = 8,
  writebackDamping = 0.15,
}) {
  return {
    density,
    compliance: {
      stretch,
      shear: stretch * 1.2,
      area,
      bend: area * 0.25,
    },
    friction: { static: 0.5, kinetic: 0.3, restitution: 0 },
    plastic: { beta: 0, yieldStrain: 1, yieldBendDeg: 180 },
    damping: { velocity: velocityDamping, writeback: writebackDamping },
    softening: { kSigma: 0.35, kPlastic: 0.2, sigmaRef: 1 },
    gridCouplingScale: 1,
    baseHue,
  };
}
