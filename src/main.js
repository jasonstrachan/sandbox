import {
  createState,
  setShape,
  addPoint,
  updatePoint,
  undoPoint,
  clearState,
  closePolygon,
  isClosed,
} from './state.js';
import { pointInPoly } from './utils/geometry.js';
import { createModes } from './modes/index.js';
import { getExpressiveBrushEngine } from './modes/expressiveBrush.js';
import { getExpressivePixelBrushEngine } from './modes/expressivePixelBrush.js';

const defaultShape = [
  { x: 620, y: 140 },
  { x: 704, y: 217 },
  { x: 846, y: 194 },
  { x: 805, y: 343 },
  { x: 920, y: 420 },
  { x: 832, y: 508 },
  { x: 839, y: 639 },
  { x: 700, y: 614 },
  { x: 620, y: 700 },
  { x: 528, y: 642 },
  { x: 408, y: 632 },
  { x: 426, y: 500 },
  { x: 330, y: 420 },
  { x: 417, y: 336 },
  { x: 401, y: 201 },
  { x: 543, y: 235 },
];

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const overlayCanvas = document.getElementById('overlay');
const overlayCtx = overlayCanvas.getContext('2d');

const lockedLayers = [];

const controls = mapControls([
  'controls',
  'mode',
  'btn-close',
  'btn-clear',
  'color',
  'bg',
  'strokeLW',
  'hAngle',
  'hSpace',
  'hLW',
  'hOrganic',
  'hCross',
  'hCrossSize',
  'hShearSegments',
  'hShearOffset',
  'cGap',
  'cStep',
  'isoGlowStep',
  'isoGlowSpacing',
  'isoGlowFeather',
  'isoGlowGlowAlpha',
  'isoGlowBandAlpha',
  'isoGlowMaxDist',
  'mosaicSpacing',
  'mosaicRelax',
  'mosaicHexRatio',
  'mosaicJitter',
  'mosaicShade',
  'mosaicOutline',
  'mosaicSeed',
  'ribbonSpacing',
  'ribbonStep',
  'ribbonMax',
  'ribbonTangent',
  'ribbonBiasAngle',
  'ribbonNoiseStrength',
  'ribbonNoiseScale',
  'ribbonNoiseOctaves',
  'ribbonLineWidth',
  'ribbonJitter',
  'ribbonAnchor',
  'ribbonSeed',
  'fSeed',
  'fStep',
  'fMax',
  'fOrtho',
  'gAngle',
  'gInfl',
  'gSeed',
  'gStep',
  'gMax',
  'skinAngle',
  'skinSpacing',
  'skinFalloff',
  'skinStep',
  'clipAngle',
  'clipSpacing',
  'clipLW',
  'clipFalloffNear',
  'clipFalloffFar',
  'netSpacing',
  'netWarp',
  'netNoiseScale',
  'netLineWidth',
  'netSeed',
  'nSeedSpace',
  'nStep',
  'nMax',
  'nScale',
  'nOct',
  'nAngle',
  'nCurl',
  'nSeed',
  'ndSeedSpace',
  'ndStep',
  'ndMax',
  'ndScale',
  'ndOct',
  'ndAngle',
  'ndSeed',
  'ndDash',
  'ndGap',
  'ndJitter',
  'ndFalloffNear',
  'ndFalloffFar',
  'ndPhase',
  'ndEven',
  'stippleDotsSpacing',
  'stippleDotsSize',
  'stippleDotsSizeJitter',
  'stippleDotsScatter',
  'stippleDotsNoiseScale',
  'stippleDotsNoiseStrength',
  'stippleDotsSeed',
  'stippleDashesSpacing',
  'stippleDashesLength',
  'stippleDashesLengthJitter',
  'stippleDashesWeight',
  'stippleDashesWeightJitter',
  'stippleDashesScatter',
  'stippleDashesFalloffNear',
  'stippleDashesFalloffFar',
  'stippleDashesAngle',
  'stippleDashesAngleDrift',
  'stippleDashesAngleScale',
  'stippleDashesSeed',
  'handCirclesSpacing',
  'handCirclesSizeRatio',
  'handCirclesSizeJitter',
  'handCirclesWobble',
  'handCirclesFill',
  'handCirclesSeed',
  'vorSpacingDiv',
  'vorSpacingMin',
  'vorFalloff',
  'vorModA',
  'vorModB',
  'vorAmplitude',
  'vorSampleStep',
  'vorShardsSpacingDiv',
  'vorShardsSpacingMin',
  'vorShardsLineSpacing',
  'vorShardsAngle',
  'vorShardsAngleJitter',
  'vorShardsJitter',
  'vorShardsGradient',
  'spiralBloomOrigin',
  'spiralBloomArms',
  'spiralBloomTurns',
  'spiralBloomTightness',
  'spiralBloomWobble',
  'spiralBloomDensity',
  'spiralBloomPhase',
  'spiralBloomJitter',
  'spiralBloomSeed',
  'spiralBloomCornerPull',
  'spiralBloomStartRadius',
  'tensorSpacingMin',
  'tensorSpacingDiv',
  'tensorLineWidthScale',
  'tensorGlyphScale',
  'tensorAngleDrift',
  'tensorAngleSeparation',
  'washLayers',
  'washScale',
  'washScaleJitter',
  'washNoiseScale',
  'washThreshold',
  'washOpacity',
  'washHueJitter',
  'washSatJitter',
  'washLightnessJitter',
  'washSeed',
  'weaveAngle',
  'weaveSpacing',
  'weaveWidth',
  'weaveMod',
  'weaveNoiseScale',
  'weaveOctaves',
  'weaveOffset',
  'weaveContrast',
  'weaveAccentColor',
  'weaveSeed',
  'brushSpread',
  'brushClump',
  'brushSolvent',
  'brushJitter',
  'brushStiffness',
  'brushSpacingJitter',
  'brushPaintLoad',
  'brushGpuDiffusion',
  'pxBrushSpread',
  'pxBrushClump',
  'pxBrushSolvent',
  'pxBrushJitter',
  'pxBrushStiffness',
  'pxBrushSpacingJitter',
  'pxBrushPaintLoad',
  'pxBrushPixelSize',
  'asciiFontSize',
  'asciiSpacing',
  'asciiJitter',
  'asciiAngle',
  'asciiCharset',
]);

const controlSettings = createControlSettingsManager(controls);
controlSettings.applyToControls();

const panels = {
  hatch: document.getElementById('panel-hatch'),
  net: document.getElementById('panel-net'),
  contours: document.getElementById('panel-contours'),
  isolineGlow: document.getElementById('panel-isolineGlow'),
  mosaicTessellation: document.getElementById('panel-mosaicTessellation'),
  inkRibbons: document.getElementById('panel-inkRibbons'),
  expressiveBrush: document.getElementById('panel-expressiveBrush'),
  pixelatedBrush: document.getElementById('panel-pixelatedBrush'),
  asciiFill: document.getElementById('panel-asciiFill'),
  flow: document.getElementById('panel-flow'),
  guided: document.getElementById('panel-guided'),
  skinFlow: document.getElementById('panel-skinFlow'),
  clipFlow: document.getElementById('panel-clipFlow'),
  noise: document.getElementById('panel-noise'),
  noiseDashed: document.getElementById('panel-noiseDashed'),
  stippleDots: document.getElementById('panel-stippleDots'),
  stippleDashes: document.getElementById('panel-stippleDashes'),
  handdrawnCircles: document.getElementById('panel-handdrawnCircles'),
  voronoiShards: document.getElementById('panel-voronoiShards'),
  spiralBloom: document.getElementById('panel-spiralBloom'),
  watercolorWash: document.getElementById('panel-watercolorWash'),
  fabricWeave: document.getElementById('panel-fabricWeave'),
  exampleVoronoi: document.getElementById('panel-exampleVoronoi'),
  exampleTensor: document.getElementById('panel-exampleTensor'),
};

const state = createState();
setShape(state, defaultShape);

const categoryButtons = Array.from(document.querySelectorAll('#mode-categories button'));
let currentCategory = (() => {
  const storedCategory = controlSettings.getCustomValue('modeCategory');
  if (storedCategory && categoryButtons.some((btn) => btn.dataset.category === storedCategory)) {
    return storedCategory;
  }
  const modeOption = controls['mode']?.selectedOptions?.[0];
  const modeCategory = modeOption?.dataset.category;
  if (modeCategory && categoryButtons.some((btn) => btn.dataset.category === modeCategory)) {
    return modeCategory;
  }
  return categoryButtons.find((btn) => btn.classList.contains('active'))?.dataset.category || 'lines';
})();

const modes = createModes();
const brushEngines = {
  expressiveBrush: getExpressiveBrushEngine(),
  pixelatedBrush: getExpressivePixelBrushEngine(),
};

Object.values(brushEngines).forEach((engine) => {
  engine.attachEnvironment({ canvas, ctx, overlayCtx, controls, mapPoint: canvasPoint });
  engine.setActive(false);
});

const brushModeIds = new Set(Object.keys(brushEngines));

function isBrushMode(mode) {
  return brushModeIds.has(mode);
}

function getActiveBrushEngine() {
  const mode = controls['mode']?.value;
  return mode ? brushEngines[mode] || null : null;
}

function activateBrushMode(mode) {
  let activeEngine = null;
  Object.entries(brushEngines).forEach(([id, engine]) => {
    const shouldBeActive = id === mode;
    engine.setActive(shouldBeActive);
    if (shouldBeActive) {
      if (typeof engine.syncSettings === 'function') engine.syncSettings();
      if (typeof engine.refreshPalette === 'function') engine.refreshPalette();
      if (typeof engine.refreshFrame === 'function') engine.refreshFrame();
      activeEngine = engine;
    }
  });
  if (!activeEngine && overlayCtx) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }
  return activeEngine;
}

const dragNumberState = {
  active: false,
  input: null,
  startValue: 0,
  startX: 0,
  startY: 0,
  pointerId: null,
  step: 1,
  min: -Infinity,
  max: Infinity,
  moved: false,
  lastValue: null,
};

const dragVertex = {
  active: false,
  index: -1,
  pointerId: null,
  offsetX: 0,
  offsetY: 0,
};

const freeDraw = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  started: false,
};

const FREE_DRAW_START_DIST2 = 16;
const FREE_DRAW_MIN_DIST2 = 36;

const autoTrigger = debounce(() => {
  const mode = controls['mode'].value;
  if (isBrushMode(mode)) {
    const active = brushEngines[mode];
    if (active) {
      if (typeof active.syncSettings === 'function') active.syncSettings();
      if (typeof active.refreshPalette === 'function') active.refreshPalette();
      if (typeof active.refreshFrame === 'function') active.refreshFrame();
    }
    return;
  }
  if (isClosed(state)) runSelectedMode();
}, 120);

controls['mode'].addEventListener('change', () => {
  const mode = controls['mode'].value;
  showPanel(mode);
  const isBrush = isBrushMode(mode);
  activateBrushMode(mode);
  if (isBrush) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    return;
  }
  if (isClosed(state)) runSelectedMode();
});

showPanel(controls['mode'].value);
initializeModeCategories();
activateBrushMode(controls['mode'].value);

const controlRoot = controls['controls'];
controlRoot.addEventListener('input', (event) => {
  controlSettings.handleEvent(event);
  const mode = controls['mode'].value;
  if (isBrushMode(mode)) {
    if (event.target === controls['color'] || event.target === controls['bg']) {
      const engine = brushEngines[mode];
      if (engine && typeof engine.refreshPalette === 'function') engine.refreshPalette();
    }
    autoTrigger();
    return;
  }
  const panel = panels[mode];
  if (panel && panel.contains(event.target)) autoTrigger();
});
controlRoot.addEventListener('change', (event) => {
  controlSettings.handleEvent(event);
  const mode = controls['mode'].value;
  if (isBrushMode(mode)) {
    if (event.target === controls['color'] || event.target === controls['bg']) {
      const engine = brushEngines[mode];
      if (engine && typeof engine.refreshPalette === 'function') engine.refreshPalette();
    }
    autoTrigger();
    return;
  }
  const panel = panels[mode];
  if (panel && panel.contains(event.target)) autoTrigger();
});

setupNumberDrag();
setupCanvasInteractions();
setupBasicControls();
setupModeKeyboardNavigation();

renderPreview();
if (isClosed(state)) runSelectedMode();
selfTest();

function runSelectedMode({
  targetCtx = ctx,
  includeLockedLayers = true,
  fillBackground = true,
  clear = true,
} = {}) {
  const modeName = controls['mode'].value;
  const runner = modes[modeName];
  if (!runner) return;

  const targetCanvas = targetCtx.canvas || canvas;
  const helpersBundle = createModeHelpers({
    targetCtx,
    includeLockedLayers,
    fillBackground,
    clear,
  });

  runner({ canvas: targetCanvas, ctx: targetCtx, state, controls, helpers: helpersBundle });
}

function createModeHelpers({ targetCtx, includeLockedLayers, fillBackground, clear }) {
  const defaults = { includeLockedLayers, fillBackground, clear };
  return {
    ensureClosed,
    renderPreview,
    renderDefaults: defaults,
    tracePolygonPath: () => tracePolygonPath(targetCtx, state),
    prepareRender: (options = {}) => {
      const merged = { ...defaults, ...options };
      prepareRender(targetCtx, merged);
    },
    overlayCtx,
    mapPoint: canvasPoint,
  };
}

function commitActiveShapeLayer() {
  if (!isClosed(state) || !state.pts.length) return;

  const layerCanvas = document.createElement('canvas');
  layerCanvas.width = canvas.width;
  layerCanvas.height = canvas.height;
  const layerCtx = layerCanvas.getContext('2d');
  runSelectedMode({
    targetCtx: layerCtx,
    includeLockedLayers: false,
    fillBackground: false,
  });

  lockedLayers.push({ canvas: layerCanvas });
}

function clearLockedLayers() {
  lockedLayers.length = 0;
}

function setupBasicControls() {
  controls['btn-close'].addEventListener('click', () => {
    const activeBrush = getActiveBrushEngine();
    if (activeBrush) {
      if (typeof activeBrush.refreshFrame === 'function') activeBrush.refreshFrame();
      return;
    }
    const wasClosed = isClosed(state);
    closePolygon(state);
    if (!wasClosed && isClosed(state)) runSelectedMode();
    renderPreview();
  });

  controls['btn-clear'].addEventListener('click', () => {
    const activeBrush = getActiveBrushEngine();
    if (activeBrush) {
      if (typeof activeBrush.clearSurface === 'function') activeBrush.clearSurface();
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      return;
    }
    clearLockedLayers();
    clearState(state);
    renderPreview();
  });

  controls['color'].addEventListener('input', () => {
    const activeBrush = getActiveBrushEngine();
    if (activeBrush) {
      if (typeof activeBrush.refreshPalette === 'function') activeBrush.refreshPalette();
      if (typeof activeBrush.refreshFrame === 'function') activeBrush.refreshFrame();
      return;
    }
    renderPreview();
    if (isClosed(state)) runSelectedMode();
  });

  controls['bg'].addEventListener('input', () => {
    const activeBrush = getActiveBrushEngine();
    if (activeBrush) {
      if (typeof activeBrush.refreshPalette === 'function') activeBrush.refreshPalette();
      if (typeof activeBrush.refreshFrame === 'function') activeBrush.refreshFrame();
      return;
    }
    renderPreview();
    if (isClosed(state)) runSelectedMode();
  });

  controls['strokeLW'].addEventListener('input', () => {
    if (isClosed(state)) runSelectedMode();
  });

  window.addEventListener('keydown', (event) => {
    const activeBrush = getActiveBrushEngine();
    if (activeBrush) {
      if (event.key === 'Escape' && typeof activeBrush.clearSurface === 'function') {
        activeBrush.clearSurface();
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
      return;
    }

    if (event.key === 'Enter') {
      const wasClosed = isClosed(state);
      closePolygon(state);
      renderPreview();
      if (!wasClosed && isClosed(state)) runSelectedMode();
    } else if (event.key === 'Escape') {
      clearState(state);
      renderPreview();
    } else if (event.key.toLowerCase() === 'z') {
      undoPoint(state);
      renderPreview();
    }
  });
}

function setupModeKeyboardNavigation() {
  const select = controls['mode'];
  if (!select) return;

  select.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();

    const visibleOptions = Array.from(select.options).filter((option) => !option.hidden && !option.disabled);
    if (!visibleOptions.length) return;

    let index = visibleOptions.findIndex((option) => option.value === select.value);
    if (index === -1) index = 0;

    index += event.key === 'ArrowDown' ? 1 : -1;
    if (index < 0) index = visibleOptions.length - 1;
    if (index >= visibleOptions.length) index = 0;

    const next = visibleOptions[index];
    if (!next || next.value === select.value) return;

    select.value = next.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function initializeModeCategories() {
  if (!categoryButtons.length) return;
  applyCategoryFilter(currentCategory, { suppressRun: true });
  categoryButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const category = btn.dataset.category;
      if (!category || category === currentCategory) return;
      applyCategoryFilter(category);
    });
  });
}

function applyCategoryFilter(category, { suppressRun = false } = {}) {
  currentCategory = category;
  controlSettings.setCustomValue('modeCategory', category);
  categoryButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  const options = Array.from(controls['mode'].options);
  let firstVisible = null;
  for (const option of options) {
    const cats = (option.dataset.category || 'lines').split(/\s+/);
    const match = cats.includes(category);
    option.hidden = !match;
    if (match && !firstVisible) firstVisible = option;
  }

  if (!firstVisible) return;

  const selectedOption = controls['mode'].options[controls['mode'].selectedIndex];
  const needsChange = !selectedOption || selectedOption.hidden;
  if (needsChange) {
    controls['mode'].value = firstVisible.value;
    controlSettings.syncControl('mode');
    controls['mode'].dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  showPanel(controls['mode'].value);
  activateBrushMode(controls['mode'].value);
  if (!suppressRun && isClosed(state)) runSelectedMode();
}

function setupNumberDrag() {
  controlRoot.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const input = event.target.closest('input[type="number"]');
    if (!input || dragNumberState.active) return;

    dragNumberState.active = true;
    dragNumberState.input = input;
    dragNumberState.pointerId = event.pointerId;
    dragNumberState.startX = event.clientX;
    dragNumberState.startY = event.clientY;

    const current = parseFloat(input.value);
    dragNumberState.startValue = Number.isFinite(current) ? current : 0;

    const stepAttr = parseFloat(input.step);
    dragNumberState.step = Number.isFinite(stepAttr) && stepAttr > 0 ? stepAttr : 1;

    const minAttr = input.min === '' ? null : parseFloat(input.min);
    const maxAttr = input.max === '' ? null : parseFloat(input.max);
    dragNumberState.min = Number.isFinite(minAttr) ? minAttr : -Infinity;
    dragNumberState.max = Number.isFinite(maxAttr) ? maxAttr : Infinity;

    dragNumberState.moved = false;
    dragNumberState.lastValue = null;

    input.focus({ preventScroll: true });
    if (typeof input.setPointerCapture === 'function') {
      try {
        input.setPointerCapture(event.pointerId);
      } catch (err) {
        console.warn('Pointer capture failed', err);
      }
    }
  });

  const updateDrag = (event) => {
    const s = dragNumberState;
    if (!s.active || event.pointerId !== s.pointerId || !s.input) return;
    const delta = s.startY - event.clientY;
    if (!s.moved && Math.abs(delta) < 3) return;
    if (!s.moved) {
      s.moved = true;
      document.body.classList.add('dragging-number');
    }

    let sensitivity = 0.35;
    if (event.shiftKey) sensitivity = 0.08;
    else if (event.altKey || event.metaKey) sensitivity = 0.02;
    else if (event.ctrlKey) sensitivity = 0.65;

    let candidate = s.startValue + delta * s.step * sensitivity;
    candidate = snapToStep(candidate, s.step);
    candidate = clamp(candidate, s.min, s.max);
    if (candidate === s.lastValue) return;
    s.lastValue = candidate;
    s.input.value = String(candidate);
    s.input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const endDrag = (event) => {
    const s = dragNumberState;
    if (!s.active || event.pointerId !== s.pointerId || !s.input) return;
    if (typeof s.input.releasePointerCapture === 'function') {
      try {
        if (typeof s.input.hasPointerCapture === 'function') {
          if (s.input.hasPointerCapture(event.pointerId)) s.input.releasePointerCapture(event.pointerId);
        } else {
          s.input.releasePointerCapture(event.pointerId);
        }
      } catch (err) {
        console.warn('Release pointer capture failed', err);
      }
    }
    if (s.moved) {
      s.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.body.classList.remove('dragging-number');
    s.active = false;
    s.input = null;
    s.pointerId = null;
    s.lastValue = null;
    s.moved = false;
    s.startValue = 0;
    s.step = 1;
    s.min = -Infinity;
    s.max = Infinity;
    s.startX = 0;
    s.startY = 0;
  };

  window.addEventListener('pointermove', updateDrag);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function setupCanvasInteractions() {
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const activeBrush = getActiveBrushEngine();
    if (activeBrush) {
      const handled = activeBrush.handlePointerDown(event);
      freeDraw.active = false;
      dragVertex.active = false;
      if (handled && typeof canvas.setPointerCapture === 'function') {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch (err) {
          console.warn('Canvas capture failed', err);
        }
      }
      if (handled) event.preventDefault();
      return;
    }
    const { x, y } = canvasPoint(event);
    const idx = hitVertex(x, y);
    if (idx >= 0) {
      freeDraw.active = false;
      dragVertex.active = true;
      dragVertex.index = idx;
      dragVertex.pointerId = event.pointerId;
      dragVertex.offsetX = state.pts[idx].x - x;
      dragVertex.offsetY = state.pts[idx].y - y;
      if (typeof canvas.setPointerCapture === 'function') {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch (err) {
          console.warn('Canvas capture failed', err);
        }
      }
      renderPreview();
      event.preventDefault();
      return;
    }

    if (!activeBrush && isClosed(state) && state.pts.length) {
      commitActiveShapeLayer();
      clearState(state);
      renderPreview();
    }

    if (!activeBrush) {
      freeDraw.active = true;
      freeDraw.pointerId = event.pointerId;
      freeDraw.startX = x;
      freeDraw.startY = y;
      freeDraw.lastX = x;
      freeDraw.lastY = y;
      freeDraw.started = false;
      if (typeof canvas.setPointerCapture === 'function') {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch (err) {
          console.warn('Canvas capture failed', err);
        }
      }
      event.preventDefault();
    }
  });

  window.addEventListener('pointermove', (event) => {
    const activeBrush = getActiveBrushEngine();
    if (activeBrush && activeBrush.isActive()) {
      const handled = activeBrush.handlePointerMove(event);
      if (handled) event.preventDefault();
      return;
    }
    if (dragVertex.active && event.pointerId === dragVertex.pointerId) {
      const { x, y } = canvasPoint(event);
      const idx = dragVertex.index;
      if (idx < 0 || idx >= state.pts.length) return;
      updatePoint(state, idx, { x: x + dragVertex.offsetX, y: y + dragVertex.offsetY });
      renderPreview();
      if (isClosed(state)) autoTrigger();
      return;
    }

    if (!freeDraw.active || event.pointerId !== freeDraw.pointerId) return;
    const { x, y } = canvasPoint(event);
    let updated = false;
    if (!freeDraw.started) {
      const dx0 = x - freeDraw.startX;
      const dy0 = y - freeDraw.startY;
      if (dx0 * dx0 + dy0 * dy0 >= FREE_DRAW_START_DIST2) {
        clearState(state);
        addPoint(state, { x: freeDraw.startX, y: freeDraw.startY });
        freeDraw.lastX = freeDraw.startX;
        freeDraw.lastY = freeDraw.startY;
        freeDraw.started = true;
        updated = true;
      }
    }
    if (!freeDraw.started) return;
    const dx = x - freeDraw.lastX;
    const dy = y - freeDraw.lastY;
    if (dx * dx + dy * dy >= FREE_DRAW_MIN_DIST2) {
      addPoint(state, { x, y });
      freeDraw.lastX = x;
      freeDraw.lastY = y;
      updated = true;
    }
    if (updated) renderPreview();
  });

  const handlePointerUp = (event) => {
    const activeBrush = getActiveBrushEngine();
    if (activeBrush && activeBrush.isActive()) {
      const handled = activeBrush.handlePointerUp(event);
      if (handled && typeof canvas.releasePointerCapture === 'function') {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch (err) {
          console.warn('Canvas release failed', err);
        }
      }
      if (handled) event.preventDefault();
      return;
    }
    if (dragVertex.active && event.pointerId === dragVertex.pointerId) {
      if (typeof canvas.releasePointerCapture === 'function') {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch (err) {
          console.warn('Canvas release failed', err);
        }
      }
      dragVertex.active = false;
      dragVertex.index = -1;
      dragVertex.pointerId = null;
      dragVertex.offsetX = 0;
      dragVertex.offsetY = 0;
      if (isClosed(state)) runSelectedMode();
      renderPreview();
    }

    if (!freeDraw.active || event.pointerId !== freeDraw.pointerId) return;
    if (typeof canvas.releasePointerCapture === 'function') {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (err) {
        console.warn('Canvas release failed', err);
      }
    }

    const { x, y } = canvasPoint(event);
    if (freeDraw.started) {
      const dx = x - freeDraw.lastX;
      const dy = y - freeDraw.lastY;
      if (dx * dx + dy * dy >= FREE_DRAW_MIN_DIST2 / 4) {
        addPoint(state, { x, y });
      } else if (state.pts.length) {
        updatePoint(state, state.pts.length - 1, { x, y });
      }
      if (state.pts.length >= 3) {
        closePolygon(state);
      }
      renderPreview();
      if (isClosed(state)) runSelectedMode();
    } else {
      addPoint(state, { x, y });
      renderPreview();
      if (isClosed(state)) runSelectedMode();
    }

    freeDraw.active = false;
    freeDraw.pointerId = null;
    freeDraw.started = false;
    freeDraw.startX = 0;
    freeDraw.startY = 0;
    freeDraw.lastX = 0;
    freeDraw.lastY = 0;
  };

  const handlePointerCancel = (event) => {
    const activeBrush = getActiveBrushEngine();
    if (activeBrush && activeBrush.isActive()) {
      const handled = activeBrush.handlePointerCancel(event);
      if (handled && typeof canvas.releasePointerCapture === 'function') {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch (err) {
          console.warn('Canvas release failed', err);
        }
      }
      if (handled) event.preventDefault();
      return;
    }
    let needsRender = false;
    if (dragVertex.active && event.pointerId === dragVertex.pointerId) {
      if (typeof canvas.releasePointerCapture === 'function') {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch (err) {
          console.warn('Canvas release failed', err);
        }
      }
      dragVertex.active = false;
      dragVertex.index = -1;
      dragVertex.pointerId = null;
      dragVertex.offsetX = 0;
      dragVertex.offsetY = 0;
      needsRender = true;
    }

    if (freeDraw.active && event.pointerId === freeDraw.pointerId) {
      if (typeof canvas.releasePointerCapture === 'function') {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch (err) {
          console.warn('Canvas release failed', err);
        }
      }
      freeDraw.active = false;
      freeDraw.pointerId = null;
      freeDraw.started = false;
      freeDraw.startX = 0;
      freeDraw.startY = 0;
      freeDraw.lastX = 0;
      freeDraw.lastY = 0;
      needsRender = true;
    }

    if (needsRender) renderPreview();
  };

  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerCancel);
}

function ensureClosed() {
  const wasClosed = isClosed(state);
  if (!wasClosed) closePolygon(state);
  if (!wasClosed && isClosed(state)) renderPreview();
  return isClosed(state);
}

function renderPreview() {
  if (isBrushMode(controls['mode'].value)) {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    return;
  }
  if (!state.pts.length) {
    prepareRender();
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    return;
  }

  if (!isClosed(state)) {
    prepareRender();
  }

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (state.closed && !dragVertex.active) {
    return;
  }

  overlayCtx.save();
  overlayCtx.strokeStyle = '#4e6aa1';
  overlayCtx.lineWidth = 1.5;
  overlayCtx.setLineDash([6, 6]);
  overlayCtx.beginPath();
  overlayCtx.moveTo(state.pts[0].x, state.pts[0].y);
  for (let i = 1; i < state.pts.length; i++) overlayCtx.lineTo(state.pts[i].x, state.pts[i].y);
  if (state.closed) overlayCtx.closePath();
  overlayCtx.stroke();
  overlayCtx.setLineDash([]);
  for (const p of state.pts) {
    overlayCtx.beginPath();
    overlayCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    overlayCtx.fillStyle = '#a7c4ff';
    overlayCtx.fill();
  }
  overlayCtx.restore();
}

function prepareRender(targetCtx = ctx, options = {}) {
  const {
    fillBackground = true,
    includeLockedLayers = fillBackground && targetCtx === ctx,
    clear = true,
  } = options;

  const targetCanvas = targetCtx.canvas || canvas;

  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.globalAlpha = 1;
  targetCtx.lineDashOffset = 0;
  if (clear) {
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  }
  if (fillBackground) {
    targetCtx.fillStyle = controls['bg'].value;
    targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  }
  if (includeLockedLayers) {
    drawLockedLayers(targetCtx);
  }
  targetCtx.restore();
}

function tracePolygonPath(targetCtx = ctx, targetState = state) {
  if (!targetState.pts.length) return;
  targetCtx.beginPath();
  targetCtx.moveTo(targetState.pts[0].x, targetState.pts[0].y);
  for (let i = 1; i < targetState.pts.length; i++) targetCtx.lineTo(targetState.pts[i].x, targetState.pts[i].y);
  targetCtx.closePath();
}

function drawLockedLayers(targetCtx) {
  if (!lockedLayers.length) return;
  for (const layer of lockedLayers) {
    if (!layer?.canvas) continue;
    targetCtx.drawImage(layer.canvas, 0, 0);
  }
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function hitVertex(x, y, radius = 14) {
  const r2 = radius * radius;
  for (let i = 0; i < state.pts.length; i++) {
    const p = state.pts[i];
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy <= r2) return i;
  }
  return -1;
}

function showPanel(mode) {
  document.querySelectorAll('.mode-panel').forEach((panel) => panel.classList.add('hidden'));
  const panel = panels[mode];
  if (panel) panel.classList.remove('hidden');
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function snapToStep(value, step) {
  if (!Number.isFinite(step) || step <= 0) return value;
  const precision = Math.max(0, (step.toString().split('.')[1] || '').length);
  const snapped = Math.round(value / step) * step;
  return precision ? Number(snapped.toFixed(precision)) : snapped;
}

function clamp(value, min, max) {
  if (Number.isFinite(min) && value < min) return min;
  if (Number.isFinite(max) && value > max) return max;
  return value;
}

function createControlSettingsManager(controlMap) {
  const STORAGE_KEY = 'polygon-sandbox-control-settings-v1';
  const SAVE_DEBOUNCE_MS = 80;
  const CUSTOM_PREFIX = '@';
  const hasWindow = typeof window !== 'undefined';
  const storage = (() => {
    if (!hasWindow) return null;
    try {
      return window.localStorage;
    } catch (err) {
      console.warn('Local storage unavailable', err);
      return null;
    }
  })();

  let cache = loadSettings();
  let applyGuard = false;
  let saveTimer = null;

  function loadSettings() {
    if (!storage) return {};
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      console.warn('Failed to load stored settings', err);
      return {};
    }
  }

  function scheduleSave() {
    if (!storage) return;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flush();
    }, SAVE_DEBOUNCE_MS);
  }

  function flush() {
    if (!storage) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch (err) {
      console.warn('Failed to persist settings', err);
    }
  }

  if (hasWindow) {
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush, true);
  }

  function applyToControls() {
    applyGuard = true;
    const sanitizedIds = new Set();
    try {
      for (const [id, el] of Object.entries(controlMap)) {
        if (!isStorableControl(el)) continue;
        const saved = cache[id];
        if (!saved) continue;
        const result = applyStoredValue(el, saved);
        if (result?.sanitized) sanitizedIds.add(id);
      }
    } finally {
      applyGuard = false;
    }

    if (sanitizedIds.size) {
      sanitizedIds.forEach((id) => rememberControl(id, controlMap[id]));
    }
  }

  function handleEvent(event) {
    if (applyGuard) return;
    const target = event.target;
    if (!target || !(target instanceof HTMLElement)) return;
    const id = target.id;
    if (!id || controlMap[id] !== target) return;
    if (!isStorableControl(target)) return;
    rememberControl(id, target);
  }

  function syncControl(id) {
    const el = controlMap[id];
    if (!el || !isStorableControl(el)) return;
    rememberControl(id, el);
  }

  function setCustomValue(key, value) {
    if (!storage) return;
    const storageKey = `${CUSTOM_PREFIX}${key}`;
    if (value === undefined) {
      delete cache[storageKey];
    } else {
      cache[storageKey] = { kind: 'custom', value };
    }
    scheduleSave();
  }

  function getCustomValue(key) {
    const storageKey = `${CUSTOM_PREFIX}${key}`;
    const entry = cache[storageKey];
    return entry ? entry.value : undefined;
  }

  function rememberControl(id, el) {
    if (!isStorableControl(el)) return;
    const serialized = serializeControl(el);
    if (!serialized) {
      delete cache[id];
    } else {
      cache[id] = serialized;
    }
    scheduleSave();
  }

  function serializeControl(el) {
    if (el instanceof HTMLInputElement) {
      const type = el.type;
      if (type === 'checkbox') {
        return { kind: 'checkbox', value: Boolean(el.checked) };
      }
      if (type === 'number' || type === 'range') {
        const numeric = Number(el.value);
        if (Number.isFinite(numeric)) {
          return { kind: type, value: numeric };
        }
        return { kind: type, value: el.value || '' };
      }
      return { kind: type || 'input', value: el.value ?? '' };
    }
    if (el instanceof HTMLSelectElement) {
      return { kind: 'select', value: el.value };
    }
    return null;
  }

  function applyStoredValue(el, saved) {
    if (!saved || typeof saved !== 'object') return { applied: false };
    if (el instanceof HTMLInputElement) {
      switch (saved.kind) {
        case 'checkbox': {
          const next = Boolean(saved.value);
          el.checked = next;
          return { applied: true };
        }
        case 'number':
        case 'range': {
          const numeric = toFiniteNumber(saved.value);
          let sanitized = false;
          if (numeric === null) {
            if (typeof saved.value === 'string') {
              el.value = saved.value;
            }
            return { applied: true, sanitized: false };
          }
          const clamped = clampInputNumber(el, numeric);
          if (clamped !== numeric) sanitized = true;
          el.value = formatNumberForInput(el, clamped);
          return { applied: true, sanitized };
        }
        default: {
          if (typeof saved.value === 'string') {
            el.value = saved.value;
            return { applied: true };
          }
          if (saved.value == null) {
            el.value = '';
            return { applied: true };
          }
        }
      }
    }
    if (el instanceof HTMLSelectElement) {
      const stringValue = typeof saved.value === 'string' ? saved.value : String(saved.value ?? '');
      const hasOption = Array.from(el.options).some((option) => option.value === stringValue);
      if (hasOption) {
        el.value = stringValue;
        return { applied: true };
      }
    }
    return { applied: false };
  }

  function isStorableControl(el) {
    if (!el) return false;
    if (el instanceof HTMLInputElement) {
      const type = el.type;
      return type !== 'button' && type !== 'submit' && type !== 'reset';
    }
    if (el instanceof HTMLSelectElement) return true;
    return false;
  }

  function clampInputNumber(input, value) {
    let result = value;
    const minAttr = input.min === '' ? null : Number(input.min);
    const maxAttr = input.max === '' ? null : Number(input.max);
    if (Number.isFinite(minAttr) && result < minAttr) {
      result = minAttr;
    }
    if (Number.isFinite(maxAttr) && result > maxAttr) {
      result = maxAttr;
    }
    return result;
  }

  function formatNumberForInput(input, value) {
    const step = input.step;
    if (step && step !== 'any') {
      const parsedStep = Number(step);
      if (Number.isFinite(parsedStep)) {
        const precision = countStepDecimals(parsedStep);
        if (precision > 0) {
          return value.toFixed(Math.min(precision, 6)).replace(/0+$/, '').replace(/\.$/, '');
        }
      }
    }
    return Number.isInteger(value) ? String(value) : value.toString();
  }

  function countStepDecimals(step) {
    const text = step.toString();
    const idx = text.indexOf('.');
    return idx === -1 ? 0 : text.length - idx - 1;
  }

  function toFiniteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  return {
    applyToControls,
    handleEvent,
    syncControl,
    setCustomValue,
    getCustomValue,
    flush,
  };
}

function mapControls(ids) {
  return ids.reduce((acc, id) => {
    acc[id] = document.getElementById(id);
    return acc;
  }, {});
}

function selfTest() {
  try {
    const tri = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 0, y: 50 },
    ];
    console.assert(pointInPoly(10, 10, tri) === true, 'pointInPoly inside');
    console.assert(pointInPoly(40, 40, tri) === false, 'pointInPoly outside');
  } catch (err) {
    console.warn('Self-test failed', err);
  }
}
