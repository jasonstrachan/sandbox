const DEFAULT_STRETCH = 1.5e-4;
const DEFAULT_STRETCH_AXIS_SCALE = { vertical: 1.45, horizontal: 0.7, diagonal: 1 };
const DEFAULT_PLASTIC_AXIS_SCALE = { vertical: 1.3, horizontal: 0.8, diagonal: 1 };

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
  stretch = DEFAULT_STRETCH,
  stretchAxisScale,
  area = 3e-4,
  baseHue = 0,
  velocityDamping = 8,
  writebackDamping = 0.15,
  plasticBeta = 0.02,
  plasticAxisScale,
  plasticYieldStrain = 1,
  plasticYieldBendDeg = 180,
}) {
  const stretchProfile = normalizeStretchCompliance(stretch, stretchAxisScale);
  const plasticProfile = buildPlasticProfile({
    beta: plasticBeta,
    axisScale: plasticAxisScale,
    yieldStrain: plasticYieldStrain,
    yieldBendDeg: plasticYieldBendDeg,
  });
  return {
    density,
    compliance: {
      stretch: stretchProfile,
      shear: stretchProfile.default * 1.2,
      area,
      bend: area * 0.25,
    },
    friction: { static: 0.5, kinetic: 0.3, restitution: 0 },
    plastic: plasticProfile,
    damping: { velocity: velocityDamping, writeback: writebackDamping },
    softening: { kSigma: 0.35, kPlastic: 0.2, sigmaRef: 1 },
    gridCouplingScale: 1,
    baseHue,
  };
}

function normalizeStretchCompliance(value, axisScale) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const base = {
      horizontal: value.horizontal ?? value.default ?? DEFAULT_STRETCH,
      vertical: value.vertical ?? value.default ?? DEFAULT_STRETCH,
      diagonal: value.diagonal ?? value.default ?? DEFAULT_STRETCH,
      default: value.default ?? value.horizontal ?? value.vertical ?? DEFAULT_STRETCH,
    };
    return applyAxisScale(base, axisScale);
  }
  const baseValue = Number(value) || DEFAULT_STRETCH;
  const scaled = {
    horizontal: baseValue,
    vertical: baseValue,
    diagonal: baseValue,
    default: baseValue,
  };
  return applyAxisScale(scaled, axisScale ?? DEFAULT_STRETCH_AXIS_SCALE);
}

function buildPlasticProfile({ beta, axisScale, yieldStrain, yieldBendDeg }) {
  const base = makeAxisMap(beta, axisScale ?? DEFAULT_PLASTIC_AXIS_SCALE);
  return {
    beta: base,
    baseBeta: { ...base },
    controlBaseline: base.default ?? averageAxisValue(base),
    yieldStrain,
    yieldBendDeg,
  };
}

function makeAxisMap(value, axisScale) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const clone = { ...value };
    if (clone.default === undefined) {
      clone.default = clone.vertical ?? clone.horizontal ?? 0;
    }
    return applyAxisScale(clone, axisScale);
  }
  const scalar = Number(value) || 0;
  const scales = axisScale ?? DEFAULT_PLASTIC_AXIS_SCALE;
  return {
    horizontal: scalar * (scales.horizontal ?? 1),
    vertical: scalar * (scales.vertical ?? 1),
    diagonal: scalar * (scales.diagonal ?? 1),
    default: scalar,
  };
}

function applyAxisScale(map, axisScale) {
  if (!axisScale) return map;
  const next = { ...map };
  Object.entries(axisScale).forEach(([axis, scale]) => {
    if (typeof next[axis] === 'number' && Number.isFinite(scale)) {
      next[axis] = next[axis] * scale;
    }
  });
  return next;
}

function averageAxisValue(map) {
  if (!map) return 0;
  const axes = ['horizontal', 'vertical', 'diagonal'];
  let total = 0;
  let count = 0;
  axes.forEach((axis) => {
    if (typeof map[axis] === 'number') {
      total += map[axis];
      count += 1;
    }
  });
  return count ? total / count : 0;
}
