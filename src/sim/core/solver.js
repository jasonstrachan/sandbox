import { SIM_DEFAULTS } from './constants.js';

export class XPBDSolver {
  constructor(config = {}) {
    this.config = { ...SIM_DEFAULTS, ...config };
  }

  step(mesh, dt, environment = {}, iterationOverride) {
    const { substeps, gravity } = this.config;
    const iterations = iterationOverride ?? this.config.iterations;
    const subDt = dt / substeps;
    for (let stepIndex = 0; stepIndex < substeps; stepIndex += 1) {
      applyExternalForces(mesh, subDt, environment.gravity ?? gravity);
      predictPositions(mesh, subDt);
      applyBoundaryCcd(mesh, environment);
      for (let iter = 0; iter < iterations; iter += 1) {
        solveDistanceSet(mesh, subDt, environment);
        solveAreaSet(mesh, subDt, environment);
        solveBendSet(mesh, subDt);
        solveJointSet(mesh, subDt);
        solveGroundPlane(mesh, environment);
      }
      applyWriteback(mesh);
      finalizeVelocities(mesh, subDt);
      applyVelocityDamping(mesh, subDt);
      applyGroundFriction(mesh, subDt, environment);
    }
    mesh.age += dt;
  }
}

function applyExternalForces(mesh, dt, gravity) {
  mesh.particles.forEach((particle) => {
    if (particle.invMass === 0 || particle.pinned) return;
    particle.velocity.x += gravity.x * dt;
    particle.velocity.y += gravity.y * dt;
  });
}

function predictPositions(mesh, dt) {
  mesh.particles.forEach((particle) => {
    if (particle.invMass === 0 || particle.pinned) {
      particle.prevPosition = { ...particle.position };
      return;
    }
    particle.prevPosition = { ...particle.position };
    particle.position.x += particle.velocity.x * dt;
    particle.position.y += particle.velocity.y * dt;
  });
}

function solveDistanceSet(mesh, dt, environment) {
  const { stretch, shear } = mesh.topology;
  const compliance = mesh.material.compliance;
  const residuals = mesh.debug.stretchResiduals;
  const plastic = mesh.material;
  let cursor = 0;
  stretch.forEach((edge, index) => {
    residuals[cursor] = solveDistance(mesh, edge, compliance.stretch, dt, plastic);
    cursor += 1;
  });
  shear.forEach((edge) => {
    residuals[cursor] = solveDistance(mesh, edge, compliance.shear, dt, plastic);
    cursor += 1;
  });
}

function solveDistance(mesh, edge, compliance, dt, materialConfig) {
  const p0 = mesh.particles[edge.i0];
  const p1 = mesh.particles[edge.i1];
  const diffX = p1.position.x - p0.position.x;
  const diffY = p1.position.y - p0.position.y;
  let dist = Math.hypot(diffX, diffY);
  if (dist === 0) dist = 1e-8;
  const C = dist - edge.restLength;
  const w0 = p0.invMass;
  const w1 = p1.invMass;
  const wSum = w0 + w1;
  if (wSum === 0) return Math.abs(C);
  const alpha = compliance / (dt * dt);
  const lambda = -C / (wSum + alpha);
  const nx = diffX / dist;
  const ny = diffY / dist;
  const corrX = nx * lambda;
  const corrY = ny * lambda;
  if (!p0.pinned) {
    p0.position.x -= corrX * w0;
    p0.position.y -= corrY * w0;
  }
  if (!p1.pinned) {
    p1.position.x += corrX * w1;
    p1.position.y += corrY * w1;
  }
  const strain = C / (edge.restLength || 1);
  applyStretchPlasticity(edge, strain, mesh, dt, materialConfig);
  return Math.abs(C);
}

function solveAreaSet(mesh, dt, environment) {
  const triangles = mesh.topology.areas;
  const compliance = mesh.material.compliance.area;
  const residuals = mesh.debug.areaResiduals;
  triangles.forEach((triangle, index) => {
    residuals[index] = solveArea(mesh, triangle, compliance, dt, environment);
  });
}

function solveBendSet(mesh, dt) {
  const bends = mesh.topology.bends;
  if (!bends?.length) return;
  const compliance = mesh.material.compliance?.bend ?? 0;
  const residuals = mesh.debug.bendResiduals;
  bends.forEach((bend, index) => {
    residuals[index] = solveBend(mesh, bend, compliance, dt);
  });
}

function solveArea(mesh, triangle, compliance, dt, environment) {
  const [i0, i1, i2] = triangle.indices;
  const p0 = mesh.particles[i0];
  const p1 = mesh.particles[i1];
  const p2 = mesh.particles[i2];

  const area = computeTriangleArea(p0.position, p1.position, p2.position);
  const C = area - triangle.restArea;
  const strain = triangle.restArea ? C / triangle.restArea : 0;
  const grad0 = {
    x: 0.5 * (p1.position.y - p2.position.y),
    y: 0.5 * (p2.position.x - p1.position.x),
  };
  const grad1 = {
    x: 0.5 * (p2.position.y - p0.position.y),
    y: 0.5 * (p0.position.x - p2.position.x),
  };
  const grad2 = {
    x: 0.5 * (p0.position.y - p1.position.y),
    y: 0.5 * (p1.position.x - p0.position.x),
  };
  const w0 = p0.invMass;
  const w1 = p1.invMass;
  const w2 = p2.invMass;
  const sigmaRef = environment?.sigmaRef ?? 1;
  const sigma = sampleTriangleStress(environment?.grid, [p0.position, p1.position, p2.position]);
  const effCompliance = effectiveAreaCompliance(mesh, compliance, sigma, sigmaRef);
  const denom =
    w0 * (grad0.x * grad0.x + grad0.y * grad0.y) +
    w1 * (grad1.x * grad1.x + grad1.y * grad1.y) +
    w2 * (grad2.x * grad2.x + grad2.y * grad2.y) +
    effCompliance / (dt * dt);
  if (denom === 0) return Math.abs(C);
  const lambda = C / denom;
  if (!p0.pinned) {
    p0.position.x -= grad0.x * lambda * w0;
    p0.position.y -= grad0.y * lambda * w0;
  }
  if (!p1.pinned) {
    p1.position.x -= grad1.x * lambda * w1;
    p1.position.y -= grad1.y * lambda * w1;
  }
  if (!p2.pinned) {
    p2.position.x -= grad2.x * lambda * w2;
    p2.position.y -= grad2.y * lambda * w2;
  }
  applyAreaPlasticity(triangle, strain, mesh, dt);
  return Math.abs(C);
}

function sampleTriangleStress(grid, points) {
  if (!grid || !points?.length) return 0;
  let total = 0;
  points.forEach((point) => {
    total += grid.sampleStress(point.x);
  });
  return total / points.length;
}

function effectiveAreaCompliance(mesh, baseCompliance, sigma, sigmaRef) {
  const softening = mesh.material.softening ?? { kSigma: 0, kPlastic: 0 };
  const sigmaTerm = sigmaRef ? softening.kSigma * (sigma / sigmaRef) : 0;
  const plasticTerm = softening.kPlastic * (mesh.plasticStrain ?? 0);
  return baseCompliance * (1 + sigmaTerm + plasticTerm);
}

function applyStretchPlasticity(edge, strain, mesh, dt, materialConfig) {
  const plastic = materialConfig?.plastic ?? { beta: 0 };
  const beta = materialConfig?.plasticRuntimeBeta ?? plastic.beta ?? 0;
  if (!beta) return;
  const threshold = plastic.yieldStrain ?? 1;
  if (Math.abs(strain) < threshold) return;
  const drift = strain * beta * dt;
  edge.restLength = Math.max(1e-4, edge.restLength + edge.restLength * drift);
  edge.plasticStrain = (edge.plasticStrain ?? 0) + Math.abs(drift);
  mesh.plasticStrain = (mesh.plasticStrain ?? 0) + Math.abs(drift);
}

function applyAreaPlasticity(triangle, strain, mesh, dt) {
  const plastic = mesh.material.plastic ?? { beta: 0 };
  const beta = mesh.material.plasticRuntimeBeta ?? plastic.beta ?? 0;
  if (!beta || !triangle.restArea) return;
  const threshold = plastic.yieldStrain ?? 1;
  if (Math.abs(strain) < threshold) return;
  const drift = strain * beta * dt;
  triangle.restArea = Math.max(1e-4, triangle.restArea + triangle.restArea * drift);
  triangle.plasticStrain = (triangle.plasticStrain ?? 0) + Math.abs(drift);
  mesh.plasticStrain = (mesh.plasticStrain ?? 0) + Math.abs(drift) * 0.5;
}

function applyBendPlasticity(bend, magnitude, mesh, dt) {
  const plastic = mesh.material.plastic ?? { beta: 0 };
  const beta = mesh.material.plasticRuntimeBeta ?? plastic.beta ?? 0;
  if (!beta) return;
  const thresholdDeg = plastic.yieldBendDeg ?? 180;
  const threshold = (thresholdDeg * Math.PI) / 180;
  if (magnitude < threshold * 0.01) return;
  const drift = magnitude * beta * dt * 0.1;
  bend.rest.x += drift;
  bend.rest.y += drift;
  bend.plasticStrain = (bend.plasticStrain ?? 0) + Math.abs(drift);
  mesh.plasticStrain = (mesh.plasticStrain ?? 0) + Math.abs(drift) * 0.25;
}

function applyBoundaryCcd(mesh, environment) {
  if (mesh.age > 0.25) return;
  const groundY = environment.groundY ?? Infinity;
  if (!isFinite(groundY)) return;
  mesh.particles.forEach((particle) => {
    if (!particle.boundary) return;
    const prevY = particle.prevPosition.y;
    const currY = particle.position.y;
    if ((prevY - groundY) * (currY - groundY) <= 0 && currY > groundY) {
      const dy = currY - prevY;
      if (dy === 0) {
        particle.position.y = groundY;
        return;
      }
      const t = Math.min(Math.max((groundY - prevY) / dy, 0), 1);
      particle.position.x = particle.prevPosition.x + (particle.position.x - particle.prevPosition.x) * t;
      particle.position.y = groundY;
    }
  });
}

function solveGroundPlane(mesh, environment = {}) {
  const groundY = environment.groundY ?? Infinity;
  if (!isFinite(groundY)) return;
  const restitution = clamp01(environment.restitution ?? 0);
  mesh.particles.forEach((particle) => {
    if (particle.position.y > groundY) {
      particle.position.y = groundY;
      if (particle.velocity.y > 0) {
        particle.velocity.y = -particle.velocity.y * restitution;
        if (Math.abs(particle.velocity.y) < 1) particle.velocity.y = 0;
      }
    }
  });
}

function finalizeVelocities(mesh, dt) {
  mesh.particles.forEach((particle) => {
    particle.velocity.x = (particle.position.x - particle.prevPosition.x) / dt;
    particle.velocity.y = (particle.position.y - particle.prevPosition.y) / dt;
  });
}

function solveBend(mesh, bend, compliance, dt) {
  const particles = mesh.particles;
  const pPrev = particles[bend.iPrev];
  const pMid = particles[bend.iMid];
  const pNext = particles[bend.iNext];
  const Cx = pPrev.position.x - 2 * pMid.position.x + pNext.position.x - bend.rest.x;
  const Cy = pPrev.position.y - 2 * pMid.position.y + pNext.position.y - bend.rest.y;
  solveBendScalar(pPrev, pMid, pNext, Cx, compliance, dt, 'x');
  solveBendScalar(pPrev, pMid, pNext, Cy, compliance, dt, 'y');
  return Math.hypot(Cx, Cy);
}

function solveBendScalar(pPrev, pMid, pNext, C, compliance, dt, axis) {
  const wPrev = pPrev.invMass;
  const wMid = pMid.invMass;
  const wNext = pNext.invMass;
  const denom = wPrev * 1 + wMid * 4 + wNext * 1 + compliance / (dt * dt);
  if (denom === 0) return;
  const lambda = -C / denom;
  const key = axis === 'x' ? 'x' : 'y';
  if (!pPrev.pinned) pPrev.position[key] += lambda * wPrev;
  if (!pMid.pinned) pMid.position[key] -= 2 * lambda * wMid;
  if (!pNext.pinned) pNext.position[key] += lambda * wNext;
}

function solveJointSet(mesh, dt) {
  const joints = mesh.topology.joints ?? [];
  if (!joints.length) return;
  joints.forEach((joint) => {
    if (joint.broken) return;
    solveJoint(mesh, joint, dt);
  });
}

function solveJoint(mesh, joint, dt) {
  const p0 = mesh.particles[joint.i0];
  const p1 = mesh.particles[joint.i1];
  const diffX = p1.position.x - p0.position.x;
  const diffY = p1.position.y - p0.position.y;
  let dist = Math.hypot(diffX, diffY) || 1e-8;
  const C = dist - joint.restLength;
  const w0 = p0.invMass;
  const w1 = p1.invMass;
  const wSum = w0 + w1;
  if (wSum === 0) return;
  const lambda = -C / wSum;
  const nx = diffX / dist;
  const ny = diffY / dist;
  if (!p0.pinned) {
    p0.position.x -= nx * lambda * w0;
    p0.position.y -= ny * lambda * w0;
  }
  if (!p1.pinned) {
    p1.position.x += nx * lambda * w1;
    p1.position.y += ny * lambda * w1;
  }
  const strain = C / (joint.restLength || 1);
  if (Math.abs(strain) > (joint.breakStrain ?? 0.5)) {
    joint.broken = true;
  }
}

function applyWriteback(mesh) {
  const gamma = mesh.material.damping?.writeback ?? 0;
  if (!gamma) return;
  mesh.particles.forEach((particle) => {
    particle.position.x = particle.position.x * (1 - gamma) + particle.prevPosition.x * gamma;
    particle.position.y = particle.position.y * (1 - gamma) + particle.prevPosition.y * gamma;
  });
}

function applyVelocityDamping(mesh, dt) {
  const coeff = mesh.material.damping?.velocity ?? 0;
  if (!coeff) return;
  const factor = Math.exp(-coeff * dt);
  mesh.particles.forEach((particle) => {
    particle.velocity.x *= factor;
    particle.velocity.y *= factor;
  });
}

function applyGroundFriction(mesh, dt, environment) {
  const groundY = environment.groundY ?? Infinity;
  if (!isFinite(groundY)) return;
  const gravity = environment.gravity ?? { x: 0, y: 0 };
  const muStatic = mesh.material.friction?.static ?? 0.5;
  const muKinetic = mesh.material.friction?.kinetic ?? 0.3;
  mesh.particles.forEach((particle) => {
    if (particle.position.y < groundY - 0.5) return;
    if (particle.invMass === 0) return;
    if (particle.position.y > groundY) particle.position.y = groundY;
    if (particle.velocity.y > 0) particle.velocity.y = 0;
    const normalImpulse = Math.max(particle.mass * Math.abs(gravity.y) * dt, 0);
    if (normalImpulse === 0) return;
    const desiredImpulse = particle.mass * Math.abs(particle.velocity.x);
    const maxStatic = muStatic * normalImpulse;
    if (desiredImpulse <= maxStatic) {
      particle.velocity.x = 0;
    } else {
      const kineticImpulse = muKinetic * normalImpulse;
      const deltaV = kineticImpulse / particle.mass;
      if (deltaV === 0) return;
      const dir = Math.sign(particle.velocity.x) || 1;
      const next = particle.velocity.x - dir * deltaV;
      particle.velocity.x = Math.sign(next) === dir ? next : 0;
    }
  });
}

function computeTriangleArea(a, b, c) {
  return 0.5 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
