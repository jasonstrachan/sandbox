import { pointInPoly, bbox, polygonCentroid } from '../utils/geometry.js';

const TAU = Math.PI * 2;

const EXAMPLE_MODE_SETTINGS = {
  exampleVoronoi: {
    theme: { bg: '#05070f', ink: '#f0f5ff', strokeWidth: 1.4 },
    params: {
      spacingDivisor: 18,
      spacingMin: 6,
      sampleStep: 3,
      falloffScale: 1.1,
      modulationFreqA: 5,
      modulationFreqB: 2.4,
      amplitude: 0.12,
    },
  },
  exampleGVF: {
    theme: { bg: '#040c12', ink: '#f7f4ed', strokeWidth: 1.35 },
    params: {
      spacingDivisor: 15,
      spacingMin: 10,
      sampleStep: 3,
      swirlPhaseX: 0.035,
      swirlPhaseY: 0.02,
      angleFrequency: 3.4,
      amplitude: 0.1,
      radialScale: 1.05,
    },
  },
  exampleLaplacian: {
    theme: { bg: '#060607', ink: '#f2f2f0', strokeWidth: 1.3 },
    params: {
      layerCount: 16,
      shrink: 0.78,
      irregularity: 0.22,
      alphaStart: 0.9,
      alphaMin: 0.12,
      widthDecay: 0.6,
      phaseStep: 0.9,
    },
  },
  exampleConformal: {
    theme: { bg: '#04090c', ink: '#e9faff', strokeWidth: 1.2 },
    params: {
      columns: 12,
      rows: 12,
      sampleStep: 8,
      warpAmplitude: 0.25,
      verticalPhase: 0.3,
      horizontalPhase: 0.4,
      minStep: 10,
    },
  },
  exampleElectrostatic: {
    theme: { bg: '#08060b', ink: '#f8eef1', strokeWidth: 1.25 },
    params: {
      spacingMin: 10,
      spacingDivisor: 12,
      sampleStep: 3,
      chargeOffset: 0.45,
      fieldStrength: 18,
      chargeRadiusScale: 2.8,
    },
  },
  exampleCurvature: {
    theme: { bg: '#060608', ink: '#f5f5f2', strokeWidth: 1.3 },
    params: {
      spacingMin: 8,
      spacingDivisor: 18,
      sampleStep: 4,
      angleMultiplier: 6,
      curvatureBias: 0.5,
      curvatureScale: 0.5,
      offsetFrequency: 0.025,
      offsetAmplitude: 0.12,
    },
  },
  exampleAnisotropic: {
    theme: { bg: '#07060a', ink: '#f2efff', strokeWidth: 1.4 },
    params: {
      stepMin: 14,
      stepDivisor: 10,
      rotationDeg: 25,
      ellipseRatio: 0.55,
      radiusScale: 1.4,
    },
  },
  exampleHarmonic: {
    theme: { bg: '#05080c', ink: '#f0f7ff', strokeWidth: 1.3 },
    params: {
      ringStepMin: 12,
      ringStepDivisor: 8,
      ringAlphaMin: 0.18,
      ringAlphaStart: 0.9,
      lineStepMin: 18,
      lineStepDivisor: 6,
      lineCount: 5,
      lineFrequency: 0.03,
      linePhaseStep: 0.6,
      lineAmplitude: 0.35,
      lineOffsetScale: 0.45,
    },
  },
  exampleSkeleton: {
    theme: { bg: '#040608', ink: '#fdf8e9', strokeWidth: 1.4 },
    params: {
      layerCount: 10,
      shrink: 0.85,
      alphaBase: 0.85,
      alphaMin: 0.2,
      widthDecay: 0.5,
      spokeAlpha: 0.4,
      spokeWidthScale: 1.1,
    },
  },
  exampleTensor: {
    theme: { bg: '#060709', ink: '#f1f2ff', strokeWidth: 1.2 },
    params: {
      spacingMin: 11,
      spacingDivisor: 10,
      lineWidthScale: 0.85,
      glyphLengthScale: 0.15,
      angleDrift: 0.0335,
      angleSeparation: Math.PI * 91 / 180,
    },
  },
  exampleLevelSet: {
    theme: { bg: '#080809', ink: '#f5f0ff', strokeWidth: 1.3 },
    params: {
      layerCount: 9,
      shrink: 0.8,
      modulationStart: 0.1,
      modulationScale: 0.25,
      alphaBase: 0.85,
      alphaMin: 0.18,
      widthDecay: 0.5,
      phaseStep: 0.6,
    },
  },
  examplePoisson: {
    theme: { bg: '#05070a', ink: '#f5f7fb', strokeWidth: 1.1 },
    params: {
      rngSeed: 133742,
      minDistFactor: 9,
      minDistFloor: 18,
      maxSamples: 400,
      maxAttempts: 50,
      glyphLengthScale: 0.35,
      markerRadiusScale: 0.9,
      markerRadiusFloor: 1.8,
      strokeWidthScale: 0.85,
    },
  },
};

export function createExampleModes() {
  const run = (fn, name) => (deps) => {
    const { state, helpers } = deps;
    if (!helpers.ensureClosed()) return;
    const polygon = clonePolygon(state.pts);
    if (polygon.length < 3) return;
    fn({ ...deps, polygon, exampleName: name });
  };

  return {
    exampleVoronoi: run(renderVoronoiMedialAxis, 'exampleVoronoi'),
    exampleGVF: run(renderGradientVectorFlow, 'exampleGVF'),
    exampleLaplacian: run(renderLaplacianGrowth, 'exampleLaplacian'),
    exampleConformal: run(renderConformalMapping, 'exampleConformal'),
    exampleElectrostatic: run(renderElectrostaticField, 'exampleElectrostatic'),
    exampleCurvature: run(renderCurvatureFlow, 'exampleCurvature'),
    exampleAnisotropic: run(renderAnisotropicDistance, 'exampleAnisotropic'),
    exampleHarmonic: run(renderHarmonicField, 'exampleHarmonic'),
    exampleSkeleton: run(renderStraightSkeleton, 'exampleSkeleton'),
    exampleTensor: run(renderTensorField, 'exampleTensor'),
    exampleLevelSet: run(renderLevelSetEvolution, 'exampleLevelSet'),
    examplePoisson: run(renderPoissonFlow, 'examplePoisson'),
  };
}

function renderVoronoiMedialAxis(context) {
  const scene = beginScene(context);
  const { ctx, canvas, polygon, ink, lineWidth, metrics, params, controls } = scene;
  const { centroid, radius, bounds } = metrics;
  const {
    spacingDivisor: spacingDivisorDefault = 18,
    spacingMin: spacingMinDefault = 6,
    sampleStep: sampleStepDefault = 3,
    falloffScale: falloffScaleDefault = 1.1,
    modulationFreqA: modulationFreqADefault = 5,
    modulationFreqB: modulationFreqBDefault = 2.4,
    amplitude: amplitudeDefault = 0.12,
  } = params;

  const spacingDivisor = Math.max(1, numberFromControl(controls, 'vorSpacingDiv', spacingDivisorDefault));
  const spacingMin = Math.max(1, numberFromControl(controls, 'vorSpacingMin', spacingMinDefault));
  const sampleStep = Math.max(1, numberFromControl(controls, 'vorSampleStep', sampleStepDefault));
  const falloffScale = Math.max(0.05, numberFromControl(controls, 'vorFalloff', falloffScaleDefault));
  const modulationFreqA = Math.max(0, numberFromControl(controls, 'vorModA', modulationFreqADefault));
  const modulationFreqB = Math.max(0, numberFromControl(controls, 'vorModB', modulationFreqBDefault));
  const amplitude = Math.max(0, numberFromControl(controls, 'vorAmplitude', amplitudeDefault));

  ctx.save();
  clipToPolygon(ctx, polygon);
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineWidth;
  const spacing = Math.max(spacingMin, radius / spacingDivisor);
  for (let y = bounds.miny - radius; y <= bounds.maxy + radius; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= canvas.width; x += sampleStep) {
      const dx = x - centroid.x;
      const dy = y - centroid.y;
      const angle = Math.atan2(dy, dx);
      const dist = Math.hypot(dx, dy);
      const falloff = Math.max(0, 1 - dist / (radius * falloffScale));
      const modulation = Math.sin(angle * modulationFreqA) * Math.cos(angle * modulationFreqB);
      ctx.lineTo(x, y + modulation * falloff * radius * amplitude);
    }
    ctx.stroke();
  }
  ctx.restore();

  strokePolygon(ctx, polygon, ink, lineWidth * 1.15, 0.45);
  endScene(ctx);
}

function renderGradientVectorFlow(context) {
  const scene = beginScene(context);
  const { ctx, canvas, polygon, ink, lineWidth, metrics, params } = scene;
  const { centroid, radius, bounds } = metrics;
  const {
    spacingDivisor = 15,
    spacingMin = 10,
    sampleStep = 3,
    swirlPhaseX = 0.035,
    swirlPhaseY = 0.02,
    angleFrequency = 3.4,
    amplitude = 0.1,
    radialScale = 1.05,
  } = params;

  ctx.save();
  clipToPolygon(ctx, polygon);
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineWidth;
  const spacing = Math.max(spacingMin, radius / spacingDivisor);
  for (let y = bounds.miny - radius; y <= bounds.maxy + radius; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= canvas.width; x += sampleStep) {
      const dx = x - centroid.x;
      const dy = y - centroid.y;
      const dist = Math.hypot(dx, dy) || 1;
      const radial = Math.max(0, 1 - dist / (radius * radialScale));
      const angle = Math.atan2(dy, dx);
      const swirl = Math.sin(dx * swirlPhaseX + dy * swirlPhaseY) + Math.cos(angle * angleFrequency);
      ctx.lineTo(x, y + swirl * radial * radius * amplitude);
    }
    ctx.stroke();
  }
  ctx.restore();

  strokePolygon(ctx, polygon, ink, lineWidth * 1.2, 0.35);
  endScene(ctx);
}

function renderLaplacianGrowth(context) {
  const scene = beginScene(context);
  const { ctx, polygon, ink, lineWidth, metrics, params } = scene;
  const {
    layerCount = 16,
    shrink = 0.78,
    irregularity: irregularityScale = 0.22,
    alphaStart = 0.9,
    alphaMin = 0.12,
    widthDecay = 0.6,
    phaseStep = 0.9,
  } = params;
  const layers = Math.max(1, Math.round(layerCount));

  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const scale = 1 - t * shrink;
    const irregularity = irregularityScale * t;
    const scaled = scalePolygon(polygon, metrics.centroid, scale);
    const modulated = modulatePolygon(scaled, metrics.centroid, irregularity, i * phaseStep);
    ctx.save();
    ctx.globalAlpha = Math.max(alphaMin, alphaStart - t);
    ctx.lineWidth = lineWidth * (1 - t * widthDecay);
    strokePolygon(ctx, modulated, ink, ctx.lineWidth, ctx.globalAlpha);
    ctx.restore();
  }

  endScene(ctx);
}

function renderConformalMapping(context) {
  const scene = beginScene(context);
  const { ctx, polygon, ink, lineWidth, metrics, params } = scene;
  const { bounds, centroid } = metrics;
  const {
    columns = 12,
    rows = 12,
    sampleStep = 8,
    warpAmplitude = 0.25,
    verticalPhase = 0.3,
    horizontalPhase = 0.4,
    minStep = 10,
  } = params;
  const columnCount = Math.max(1, Math.round(columns));
  const rowCount = Math.max(1, Math.round(rows));

  ctx.save();
  clipToPolygon(ctx, polygon);
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineWidth;
  const stepX = Math.max(minStep, metrics.spanX / columnCount);
  const stepY = Math.max(minStep, metrics.spanY / rowCount);
  const warpX = warpAmplitude * stepX;
  const warpY = warpAmplitude * stepY;

  for (let i = -columnCount; i <= columnCount; i++) {
    ctx.beginPath();
    let first = true;
    for (let y = bounds.miny - stepY; y <= bounds.maxy + stepY; y += sampleStep) {
      const phase = (y - centroid.y) / metrics.minDim * TAU + i * verticalPhase;
      const x = centroid.x + i * stepX * 0.5 + Math.sin(phase) * warpX;
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  for (let j = -rowCount; j <= rowCount; j++) {
    ctx.beginPath();
    let first = true;
    for (let x = bounds.minx - stepX; x <= bounds.maxx + stepX; x += sampleStep) {
      const phase = (x - centroid.x) / metrics.minDim * TAU + j * horizontalPhase;
      const y = centroid.y + j * stepY * 0.5 + Math.sin(phase) * warpY;
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  ctx.restore();

  strokePolygon(ctx, polygon, ink, lineWidth * 1.1, 0.4);
  endScene(ctx);
}

function renderElectrostaticField(context) {
  const scene = beginScene(context);
  const { ctx, canvas, polygon, ink, lineWidth, metrics, params } = scene;
  const { centroid, radius, bounds } = metrics;
  const {
    spacingMin = 10,
    spacingDivisor = 12,
    sampleStep = 3,
    chargeOffset = 0.45,
    fieldStrength = 18,
    chargeRadiusScale = 2.8,
  } = params;
  const separation = radius * chargeOffset;

  ctx.save();
  clipToPolygon(ctx, polygon);
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineWidth;
  const spacing = Math.max(spacingMin, radius / spacingDivisor);
  for (let y = bounds.miny - radius; y <= bounds.maxy + radius; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= canvas.width; x += sampleStep) {
      const dx1 = x - (centroid.x - separation);
      const dy1 = y - centroid.y;
      const r1 = Math.hypot(dx1, dy1) + 1;
      const dx2 = x - (centroid.x + separation);
      const dy2 = y - centroid.y;
      const r2 = Math.hypot(dx2, dy2) + 1;
      const field = fieldStrength * (dy1 / (r1 * r1) - dy2 / (r2 * r2));
      ctx.lineTo(x, y + field);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = ink;
  const chargeRadius = lineWidth * chargeRadiusScale;
  ctx.beginPath();
  ctx.arc(centroid.x - separation, centroid.y, chargeRadius, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centroid.x + separation, centroid.y, chargeRadius, 0, TAU);
  ctx.fill();
  ctx.restore();

  strokePolygon(ctx, polygon, ink, lineWidth * 1.1, 0.35);
  endScene(ctx);
}

function renderCurvatureFlow(context) {
  const scene = beginScene(context);
  const { ctx, canvas, polygon, ink, lineWidth, metrics, params } = scene;
  const { centroid, radius, bounds } = metrics;
  const {
    spacingMin = 8,
    spacingDivisor = 18,
    sampleStep = 4,
    angleMultiplier = 6,
    curvatureBias = 0.5,
    curvatureScale = 0.5,
    offsetFrequency = 0.025,
    offsetAmplitude = 0.12,
  } = params;

  ctx.save();
  clipToPolygon(ctx, polygon);
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineWidth;
  const spacing = Math.max(spacingMin, radius / spacingDivisor);
  for (let y = bounds.miny - radius; y <= bounds.maxy + radius; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= canvas.width; x += sampleStep) {
      const angle = Math.atan2(y - centroid.y, x - centroid.x);
      const curvature = Math.sin(angle * angleMultiplier) * curvatureScale + curvatureBias;
      const offset = Math.sin(x * offsetFrequency + curvature * TAU) * curvature * radius * offsetAmplitude;
      ctx.lineTo(x, y + offset);
    }
    ctx.stroke();
  }
  ctx.restore();

  strokePolygon(ctx, polygon, ink, lineWidth * 1.15, 0.4);
  endScene(ctx);
}

function renderAnisotropicDistance(context) {
  const scene = beginScene(context);
  const { ctx, polygon, ink, lineWidth, metrics, params } = scene;
  const { centroid, radius } = metrics;
  const {
    stepMin = 14,
    stepDivisor = 10,
    rotationDeg = 25,
    ellipseRatio = 0.55,
    radiusScale = 1.4,
  } = params;

  ctx.save();
  clipToPolygon(ctx, polygon);
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineWidth;
  const step = Math.max(stepMin, radius / stepDivisor);
  ctx.translate(centroid.x, centroid.y);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  for (let r = step; r <= radius * radiusScale; r += step) {
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * ellipseRatio, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  strokePolygon(ctx, polygon, ink, lineWidth * 1.05, 0.35);
  endScene(ctx);
}

function renderHarmonicField(context) {
  const scene = beginScene(context);
  const { ctx, polygon, ink, lineWidth, metrics, params } = scene;
  const { centroid, radius, bounds } = metrics;
  const {
    ringStepMin = 12,
    ringStepDivisor = 8,
    ringAlphaMin = 0.18,
    ringAlphaStart = 0.9,
    lineStepMin = 18,
    lineStepDivisor = 6,
    lineCount = 5,
    lineFrequency = 0.03,
    linePhaseStep = 0.6,
    lineAmplitude = 0.35,
    lineOffsetScale = 0.45,
  } = params;

  ctx.save();
  clipToPolygon(ctx, polygon);
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineWidth;
  const ringStep = Math.max(ringStepMin, radius / ringStepDivisor);
  for (let r = ringStep; r <= radius * 1.1; r += ringStep) {
    ctx.save();
    ctx.globalAlpha = Math.max(ringAlphaMin, ringAlphaStart - r / (radius * 1.4));
    ctx.beginPath();
    ctx.arc(centroid.x, centroid.y, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  const lineStep = Math.max(lineStepMin, radius / lineStepDivisor);
  for (let i = -lineCount; i <= lineCount; i++) {
    ctx.beginPath();
    let first = true;
    for (let x = bounds.minx - lineStep; x <= bounds.maxx + lineStep; x += 4) {
      const y =
        centroid.y +
        i * lineStep * lineOffsetScale +
        Math.sin((x - centroid.x) * lineFrequency + i * linePhaseStep) * lineStep * lineAmplitude;
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  ctx.restore();

  strokePolygon(ctx, polygon, ink, lineWidth * 1.05, 0.4);
  endScene(ctx);
}

function renderStraightSkeleton(context) {
  const scene = beginScene(context);
  const { ctx, polygon, ink, lineWidth, metrics, params } = scene;
  const {
    layerCount = 10,
    shrink = 0.85,
    alphaBase = 0.85,
    alphaMin = 0.2,
    widthDecay = 0.5,
    spokeAlpha = 0.4,
    spokeWidthScale = 1.1,
  } = params;
  const layers = Math.max(1, Math.round(layerCount));

  for (let i = 0; i < layers; i++) {
    const t = i / (layers + 1);
    const scale = 1 - t * shrink;
    const scaled = scalePolygon(polygon, metrics.centroid, scale);
    ctx.save();
    ctx.globalAlpha = Math.max(alphaMin, alphaBase - t);
    ctx.lineWidth = lineWidth * (1 - t * widthDecay);
    strokePolygon(ctx, scaled, ink, ctx.lineWidth, ctx.globalAlpha);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = ink;
  ctx.globalAlpha = spokeAlpha;
  ctx.lineWidth = lineWidth * spokeWidthScale;
  ctx.beginPath();
  for (const point of polygon) {
    ctx.moveTo(metrics.centroid.x, metrics.centroid.y);
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();

  endScene(ctx);
}

function renderTensorField(context) {
  const scene = beginScene(context);
  const { ctx, polygon, ink, lineWidth, metrics, params, controls } = scene;
  const { bounds, centroid, radius } = metrics;
  const {
    spacingMin = 11,
    spacingDivisor = 10,
    lineWidthScale = 0.85,
    glyphLengthScale = 0.15,
    angleDrift = 0.0335,
    angleSeparation = Math.PI * 91 / 180,
  } = params;
  const spacingMinControl = Math.max(1, numberFromControl(controls, 'tensorSpacingMin', spacingMin));
  const spacingDivControl = Math.max(1, numberFromControl(controls, 'tensorSpacingDiv', spacingDivisor));
  const lineWidthScaleControl = Math.max(0.05, numberFromControl(controls, 'tensorLineWidthScale', lineWidthScale));
  const glyphScaleControl = Math.max(0.01, numberFromControl(controls, 'tensorGlyphScale', glyphLengthScale));
  const angleDriftControl = Math.max(0, numberFromControl(controls, 'tensorAngleDrift', angleDrift));
  const angleSeparationDeg = numberFromControl(controls, 'tensorAngleSeparation', angleSeparation * 180 / Math.PI);
  const angleSeparationControl = Math.max(0, angleSeparationDeg) * Math.PI / 180;
  const spacing = Math.max(spacingMinControl, radius / spacingDivControl);

  ctx.save();
  clipToPolygon(ctx, polygon);
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.2, lineWidth * lineWidthScaleControl);
  for (let x = bounds.minx; x <= bounds.maxx; x += spacing) {
    for (let y = bounds.miny; y <= bounds.maxy; y += spacing) {
      const dx = x - centroid.x;
      const dy = y - centroid.y;
      const dist = Math.hypot(dx, dy);
      const baseAngle = Math.atan2(dy, dx);
      const angle1 = baseAngle + dist * angleDriftControl;
      const angle2 = angle1 + angleSeparationControl;
      drawTensorGlyph(ctx, x, y, angle1, angle2, spacing * glyphScaleControl);
    }
  }
  ctx.restore();

  strokePolygon(ctx, polygon, ink, lineWidth * 1.05, 0.35);
  endScene(ctx);
}

function renderLevelSetEvolution(context) {
  const scene = beginScene(context);
  const { ctx, polygon, ink, lineWidth, metrics, params } = scene;
  const {
    layerCount = 9,
    shrink = 0.8,
    modulationStart = 0.1,
    modulationScale = 0.25,
    alphaBase = 0.85,
    alphaMin = 0.18,
    widthDecay = 0.5,
    phaseStep = 0.6,
  } = params;
  const layers = Math.max(1, Math.round(layerCount));

  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const scale = 1 - t * shrink;
    const mod = modulationStart + t * modulationScale;
    const scaled = scalePolygon(polygon, metrics.centroid, scale);
    const modulated = modulatePolygon(scaled, metrics.centroid, mod, i * phaseStep);
    ctx.save();
    ctx.globalAlpha = Math.max(alphaMin, alphaBase - t);
    ctx.lineWidth = lineWidth * (1 - t * widthDecay);
    strokePolygon(ctx, modulated, ink, ctx.lineWidth, ctx.globalAlpha);
    ctx.restore();
  }

  endScene(ctx);
}

function renderPoissonFlow(context) {
  const scene = beginScene(context);
  const { ctx, polygon, ink, lineWidth, metrics, params } = scene;
  const { bounds, centroid, spanX, spanY, radius } = metrics;
  const {
    rngSeed = 133742,
    minDistFactor = 9,
    minDistFloor = 18,
    maxSamples: maxSampleInput = 400,
    maxAttempts = 50,
    glyphLengthScale = 0.35,
    markerRadiusScale = 0.9,
    markerRadiusFloor = 1.8,
    strokeWidthScale = 0.85,
  } = params;
  const rng = createRng(rngSeed + Math.floor(lineWidth * 17));
  const minDist = Math.max(minDistFloor, radius / Math.max(1e-6, minDistFactor));
  const maxSamples = Math.max(1, Math.round(maxSampleInput));
  const attemptCap = maxSamples * Math.max(1, Math.round(maxAttempts));
  const samples = [];

  let attempts = 0;
  while (samples.length < maxSamples && attempts < attemptCap) {
    attempts++;
    const x = bounds.minx + rng() * spanX;
    const y = bounds.miny + rng() * spanY;
    if (!pointInPoly(x, y, polygon)) continue;
    let ok = true;
    for (const sample of samples) {
      if (distance(sample.x, sample.y, x, y) < minDist) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    samples.push({ x, y });
  }

  ctx.save();
  clipToPolygon(ctx, polygon);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1, lineWidth * strokeWidthScale);
  for (const sample of samples) {
    const angle = Math.atan2(sample.y - centroid.y, sample.x - centroid.x) + Math.PI / 2;
    const len = minDist * glyphLengthScale;
    ctx.beginPath();
    ctx.moveTo(sample.x - Math.cos(angle) * len, sample.y - Math.sin(angle) * len);
    ctx.lineTo(sample.x + Math.cos(angle) * len, sample.y + Math.sin(angle) * len);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sample.x, sample.y, Math.max(markerRadiusFloor, lineWidth * markerRadiusScale), 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  strokePolygon(ctx, polygon, ink, lineWidth * 1.05, 0.35);
  endScene(ctx);
}

function beginScene({ canvas, ctx, controls, polygon, exampleName, helpers }) {
  const width = canvas.width;
  const height = canvas.height;
  const modeSettings = exampleName ? EXAMPLE_MODE_SETTINGS[exampleName] : null;
  const theme = modeSettings?.theme || null;
  const params = modeSettings?.params || {};
  const ink = theme?.ink || controls.color.value || '#e6e8ee';
  const bg = theme?.bg || controls.bg.value || '#0a0a0e';
  const strokeOverride = Number(theme?.strokeWidth);
  const strokeControl = Number(controls.strokeLW.value);
  const lineWidth = Math.max(
    0.5,
    Number.isFinite(strokeOverride) && strokeOverride > 0
      ? strokeOverride
      : Number.isFinite(strokeControl) && strokeControl > 0
        ? strokeControl
        : 1.5,
  );
  const baseAlpha = Number.isFinite(theme?.alpha) ? theme.alpha : 1;
  const metrics = computePolygonMetrics(polygon);
  const renderDefaults = helpers?.renderDefaults || {};
  const shouldFillBackground = renderDefaults.fillBackground !== false;

  if (helpers?.prepareRender) {
    helpers.prepareRender();
  } else {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = controls.bg.value || '#0a0a0e';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (shouldFillBackground && polygon?.length) {
    ctx.save();
    polygonPath(ctx, polygon);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = baseAlpha;
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineWidth;

  return {
    canvas,
    ctx,
    controls,
    polygon,
    width,
    height,
    ink,
    bg,
    lineWidth,
    metrics,
    params,
    theme,
    exampleName,
  };
}

function endScene(ctx) {
  ctx.restore();
}

function clipToPolygon(ctx, points) {
  polygonPath(ctx, points);
  ctx.clip();
}

function polygonPath(ctx, points) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function strokePolygon(ctx, points, color, width, alpha = 1) {
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  polygonPath(ctx, points);
  ctx.stroke();
  ctx.restore();
}

function clonePolygon(points) {
  return points.map(({ x, y }) => ({ x, y }));
}

function computePolygonMetrics(polygon) {
  const bounds = bbox(polygon);
  const spanX = bounds.maxx - bounds.minx || 1;
  const spanY = bounds.maxy - bounds.miny || 1;
  const centroid = polygonCentroid(polygon);
  const maxSpan = Math.max(spanX, spanY);
  const radius = Math.max(40, maxSpan * 0.5);
  const minDim = Math.max(40, maxSpan);
  return { bounds, centroid, radius, spanX, spanY, minDim };
}

function scalePolygon(points, centroid, scale) {
  return points.map((p) => ({
    x: centroid.x + (p.x - centroid.x) * scale,
    y: centroid.y + (p.y - centroid.y) * scale,
  }));
}

function modulatePolygon(points, centroid, amount, phase) {
  if (amount <= 0) return points;
  return points.map((p, idx) => {
    const vx = p.x - centroid.x;
    const vy = p.y - centroid.y;
    const factor = 1 + Math.sin(idx * 0.9 + phase) * amount;
    return {
      x: centroid.x + vx * factor,
      y: centroid.y + vy * factor,
    };
  });
}

function drawTensorGlyph(ctx, x, y, angle1, angle2, len) {
  ctx.beginPath();
  ctx.moveTo(x - Math.cos(angle1) * len, y - Math.sin(angle1) * len);
  ctx.lineTo(x + Math.cos(angle1) * len, y + Math.sin(angle1) * len);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - Math.cos(angle2) * len, y - Math.sin(angle2) * len);
  ctx.lineTo(x + Math.cos(angle2) * len, y + Math.sin(angle2) * len);
  ctx.stroke();
}

function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s >>> 8) / 0x00ffffff;
  };
}

function distance(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function numberFromControl(controls, id, fallback) {
  if (!controls) return fallback;
  const el = controls[id];
  if (!el) return fallback;
  const value = Number(el.value);
  return Number.isFinite(value) ? value : fallback;
}
