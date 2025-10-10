import { offsetHueValue, mixHex } from '../utils/color.js';
import { getGpuDiffusionPass } from '../gpu/diffusionPass.js';

const DEFAULT_SETTINGS = {
  spread: 26,
  clump: 0.35,
  solvent: 0.18,
  jitterMacro: 0.45,
  stiffness: 0.65,
  spacingJitter: 0.3,
  paintLoad: 0.8,
  bristleCount: 84,
  gpuDiffusion: false,
};

const MAX_GPU_STAGING = 512;

const RAF = typeof window !== 'undefined' && window.requestAnimationFrame
  ? window.requestAnimationFrame.bind(window)
  : (fn) => setTimeout(fn, 16);

class ExpressiveBrushEngine {
  constructor() {
    this.canvas = null;
    this.targetCtx = null;
    this.overlayCtx = null;
    this.paintCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this.paintCtx = this.paintCanvas ? this.paintCanvas.getContext('2d') : null;
    this.controls = null;
    this.backgroundColor = '#0a0a0e';
    this.baseColor = '#ffffff';
    this.settings = { ...DEFAULT_SETTINGS };
    this.stroke = null;
    this.active = false;
    this.mapPoint = null;
    this.pendingBlit = false;
    this.needsBlit = false;
    this.useGpu = false;
    this.gpuDiffusion = null;
    this.gpuSupported = false;
    this.pendingGpuSamples = [];
    this.lastGpuStep = 0;
    this.gpuDiagnostics = {
      frameTime: 0,
      dispatchCount: 0,
      gpuSync: 0,
    };
    this.gpuFrameCounter = 0;
  }

  attachEnvironment({ canvas, ctx, overlayCtx, controls, mapPoint }) {
    this.canvas = canvas;
    this.targetCtx = ctx;
    this.overlayCtx = overlayCtx;
    this.controls = controls;
    this.mapPoint = mapPoint || this.mapPoint;
    if (controls) {
      this.baseColor = controls['color']?.value || this.baseColor;
      this.backgroundColor = controls['bg']?.value || this.backgroundColor;
    }
    this.ensureSurface();
    this.syncSettings();
    this.syncGpuSurfaceSize();
    this.requestBlit();
  }

  setActive(flag) {
    if (this.active === flag) return;
    this.active = flag;
    if (flag) {
      this.ensureSurface();
      this.clearSurface();
      this.requestBlit(true);
    } else {
      this.stroke = null;
    }
    if (this.useGpu && this.gpuDiffusion && this.paintCanvas) {
      this.gpuDiffusion.resize(this.paintCanvas.width, this.paintCanvas.height);
    }
  }

  isActive() {
    return this.active;
  }

  syncSettings() {
    if (!this.controls) return;
    const readNumber = (id, fallback) => {
      const input = this.controls[id];
      if (!input) return fallback;
      const parsed = Number(input.value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const readBoolean = (id, fallback) => {
      const input = this.controls[id];
      if (!input) return fallback;
      if (typeof input.checked === 'boolean') return Boolean(input.checked);
      return fallback;
    };
    this.settings.spread = readNumber('brushSpread', DEFAULT_SETTINGS.spread);
    this.settings.clump = readNumber('brushClump', DEFAULT_SETTINGS.clump);
    this.settings.solvent = readNumber('brushSolvent', DEFAULT_SETTINGS.solvent);
    this.settings.jitterMacro = readNumber('brushJitter', DEFAULT_SETTINGS.jitterMacro);
    this.settings.stiffness = readNumber('brushStiffness', DEFAULT_SETTINGS.stiffness);
    this.settings.spacingJitter = readNumber('brushSpacingJitter', DEFAULT_SETTINGS.spacingJitter);
    this.settings.paintLoad = readNumber('brushPaintLoad', DEFAULT_SETTINGS.paintLoad);
    this.settings.bristleCount = DEFAULT_SETTINGS.bristleCount;
    const wantGpu = readBoolean('brushGpuDiffusion', DEFAULT_SETTINGS.gpuDiffusion);
    this.settings.gpuDiffusion = wantGpu;
    if (wantGpu) {
      if (!this.useGpu) {
        const enabled = this.enableGpuDiffusion();
        if (!enabled) {
          this.settings.gpuDiffusion = false;
          if (this.controls['brushGpuDiffusion']) {
            this.controls['brushGpuDiffusion'].checked = false;
          }
        }
      }
    } else if (this.useGpu) {
      this.disableGpuDiffusion();
    }
  }

  ensureSurface() {
    if (!this.paintCanvas || !this.canvas) return;
    if (this.paintCanvas.width === this.canvas.width && this.paintCanvas.height === this.canvas.height) return;
    const tempCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (tempCanvas) {
      tempCanvas.width = this.canvas.width;
      tempCanvas.height = this.canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
      tempCtx.drawImage(this.paintCanvas, 0, 0);
      this.paintCanvas.width = this.canvas.width;
      this.paintCanvas.height = this.canvas.height;
      this.paintCtx = this.paintCanvas.getContext('2d');
      this.paintCtx.clearRect(0, 0, this.paintCanvas.width, this.paintCanvas.height);
      this.paintCtx.drawImage(tempCanvas, 0, 0);
    } else {
      this.paintCanvas.width = this.canvas.width;
      this.paintCanvas.height = this.canvas.height;
      this.paintCtx = this.paintCanvas.getContext('2d');
      this.paintCtx.clearRect(0, 0, this.paintCanvas.width, this.paintCanvas.height);
    }
  }

  refreshPalette() {
    if (!this.controls) return;
    this.baseColor = this.controls['color']?.value || this.baseColor;
    this.backgroundColor = this.controls['bg']?.value || this.backgroundColor;
  }

  clearSurface() {
    if (!this.paintCtx) return;
    this.paintCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.paintCtx.globalAlpha = 1;
    this.paintCtx.globalCompositeOperation = 'source-over';
    this.paintCtx.clearRect(0, 0, this.paintCanvas.width, this.paintCanvas.height);
    this.stroke = null;
    if (this.useGpu && this.gpuDiffusion) {
      this.gpuDiffusion.clearField();
    }
    this.requestBlit(true);
  }

  enableGpuDiffusion() {
    if (!this.canvas || !this.paintCanvas) return false;
    const width = this.canvas.width || this.paintCanvas.width;
    const height = this.canvas.height || this.paintCanvas.height;
    if (!width || !height) return false;
    const pass = getGpuDiffusionPass();
    const ok = pass.initDiffusion({ width, height });
    if (!ok) {
      this.useGpu = false;
      this.gpuSupported = false;
      this.gpuDiffusion = null;
      return false;
    }
    this.gpuDiffusion = pass;
    this.gpuSupported = true;
    this.useGpu = true;
    this.pendingGpuSamples.length = 0;
    this.lastGpuStep = performance.now ? performance.now() : Date.now();
    this.gpuDiffusion.resize(width, height);
    this.gpuDiffusion.clearField();
    return true;
  }

  disableGpuDiffusion() {
    if (this.gpuDiffusion) {
      this.gpuDiffusion.clearField();
    }
    this.pendingGpuSamples.length = 0;
    this.useGpu = false;
    this.gpuSupported = false;
  }

  syncGpuSurfaceSize() {
    if (!this.useGpu || !this.gpuDiffusion || !this.canvas) return;
    this.gpuDiffusion.resize(this.canvas.width, this.canvas.height);
  }

  queueGpuSample(x, y, radius, strength, colorHex, solvent) {
    if (!this.useGpu || !this.gpuDiffusion) return;
    const color = hexToRgbFloat(colorHex);
    this.pendingGpuSamples.push({
      x,
      y,
      radius,
      strength,
      color,
      solvent,
    });
  }

  stepGpuDiffusion() {
    if (!this.useGpu || !this.gpuDiffusion || !this.gpuSupported) return;
    const stagedCount = this.pendingGpuSamples.length;
    if (stagedCount) {
      this.gpuDiffusion.queueStylus(this.pendingGpuSamples);
      this.pendingGpuSamples.length = 0;
    }
    const now = performance.now ? performance.now() : Date.now();
    const last = this.lastGpuStep || now;
    const dt = Math.max(1 / 240, Math.min(0.05, (now - last) / 1000));
    const preFlush = performance.now ? performance.now() : Date.now();
    this.gpuDiffusion.flushQueued();
    const postFlush = performance.now ? performance.now() : Date.now();
    this.gpuDiffusion.stepParticles(dt);
    const afterStep = performance.now ? performance.now() : Date.now();
    this.lastGpuStep = now;
    this.gpuDiagnostics.frameTime = afterStep - preFlush;
    this.gpuDiagnostics.dispatchCount = stagedCount;
    this.gpuDiagnostics.gpuSync = postFlush - preFlush;
    this.gpuFrameCounter = (this.gpuFrameCounter + 1) % 120;
    if (this.gpuFrameCounter === 0 && typeof console !== 'undefined') {
      const msg = `[ExpressiveBrush][GPU] frame=${this.gpuDiagnostics.frameTime.toFixed(2)}ms sync=${this.gpuDiagnostics.gpuSync.toFixed(2)}ms queue=${this.gpuDiagnostics.dispatchCount} dt=${(dt * 1000).toFixed(1)}ms`;
      console.debug(msg);
    }
  }

  handlePointerDown(event) {
    if (!this.active || !this.paintCtx || typeof this.mapPoint !== 'function') return false;
    this.syncSettings();
    this.refreshPalette();
    const pos = this.mapPoint(event);
    const timeStamp = typeof event.timeStamp === 'number' ? event.timeStamp : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.stroke = {
      pointerId: event.pointerId,
      lastX: pos.x,
      lastY: pos.y,
      lastTime: timeStamp,
      dirX: 1,
      dirY: 0,
      bristles: this.createBristleBundle(),
    };
    this.stampBristles(pos, event, 0, { isFirst: true });
    this.requestBlit();
    return true;
  }

  handlePointerMove(event) {
    if (!this.stroke || event.pointerId !== this.stroke.pointerId) return false;
    const pos = this.mapPoint(event);
    const timeStamp = typeof event.timeStamp === 'number' ? event.timeStamp : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = Math.max(1, timeStamp - this.stroke.lastTime);
    const dx = pos.x - this.stroke.lastX;
    const dy = pos.y - this.stroke.lastY;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.4) {
      this.stroke.lastTime = timeStamp;
      return true;
    }
    const invDist = dist > 0 ? 1 / dist : 0;
    this.stroke.dirX = dx * invDist;
    this.stroke.dirY = dy * invDist;
    this.stampBristles(pos, event, dt, { velocity: dist / dt });
    this.stroke.lastX = pos.x;
    this.stroke.lastY = pos.y;
    this.stroke.lastTime = timeStamp;
    this.requestBlit();
    return true;
  }

  handlePointerUp(event) {
    if (!this.stroke || event.pointerId !== this.stroke.pointerId) return false;
    this.stroke = null;
    this.requestBlit();
    return true;
  }

  handlePointerCancel(event) {
    if (!this.stroke || event.pointerId !== this.stroke.pointerId) return false;
    this.stroke = null;
    this.requestBlit();
    return true;
  }

  stampBristles(pos, event, dt, { velocity = 0, isFirst = false } = {}) {
    if (!this.stroke || !this.paintCtx) return;
    const pressureRaw = typeof event.pressure === 'number' ? event.pressure : 0.5;
    const pressure = pressureRaw > 0 ? pressureRaw : (event.pointerType === 'mouse' ? 0.45 : 0.05);
    const tiltX = typeof event.tiltX === 'number' ? event.tiltX : 0;
    const tiltY = typeof event.tiltY === 'number' ? event.tiltY : 0;
    const twist = typeof event.twist === 'number' ? event.twist : 0;
    const twistRad = (twist * Math.PI) / 180;
    const cosR = Math.cos(twistRad);
    const sinR = Math.sin(twistRad);

    const dirX = this.stroke.dirX;
    const dirY = this.stroke.dirY;
    const normalX = -dirY;
    const normalY = dirX;
    const velocityClamped = Math.min(1.4, velocity);

    const tiltScale = Math.min(1, Math.hypot(tiltX, tiltY) / 80);
    const tiltVecX = (tiltX / 90) * this.settings.spread * 0.6 * tiltScale;
    const tiltVecY = (tiltY / 90) * this.settings.spread * 0.6 * tiltScale;

    const solvent = this.settings.solvent;
    const jitterGate = Math.pow(pressure, 0.75);

    for (const bristle of this.stroke.bristles) {
      if (!bristle) continue;
      if (this.settings.spacingJitter > 0 && velocityClamped > 0.45) {
        const skipThreshold = 1 - this.settings.spacingJitter * 0.65;
        if (bristle.spacingSeed > skipThreshold) continue;
      }

      const springFactor = 0.12 + this.settings.stiffness * 0.6;
      bristle.springX += (bristle.baseX - bristle.springX) * springFactor;
      bristle.springY += (bristle.baseY - bristle.springY) * springFactor;

      const shear = (1 - this.settings.stiffness) * 0.5 * velocityClamped;
      const shearOffsetX = normalX * shear * bristle.shearSeed * this.settings.spread * 0.4;
      const shearOffsetY = normalY * shear * bristle.shearSeed * this.settings.spread * 0.4;

      const rotatedX = bristle.springX * cosR - bristle.springY * sinR;
      const rotatedY = bristle.springX * sinR + bristle.springY * cosR;

      const tipX = pos.x + rotatedX + shearOffsetX + tiltVecX + dirX * velocityClamped * bristle.flowSeed * 4;
      const tipY = pos.y + rotatedY + shearOffsetY + tiltVecY + dirY * velocityClamped * bristle.flowSeed * 4;

      const loadFactor = bristle.reservoir > 0 ? bristle.reservoir / bristle.initialReservoir : 0;
      const color = this.computeBristleColor(bristle, jitterGate, solvent);

      const baseAlpha = pressure * (0.65 + 0.25 * loadFactor);
      const velocityFade = 1 - velocityClamped * 0.35;
      const alpha = clamp01(baseAlpha * velocityFade * (1 - solvent * 0.6));

      const widthBase = 0.35 + pressure * 1.65;
      const width = Math.max(0.2, widthBase * (0.7 + 0.4 * loadFactor) * (0.85 + (1 - velocityClamped) * 0.3));

      this.paintCtx.globalAlpha = alpha;
      this.paintCtx.strokeStyle = color;
      this.paintCtx.lineWidth = width;
      this.paintCtx.lineCap = 'round';
      this.paintCtx.lineJoin = 'round';

      if (!isFirst && bristle.lastX !== undefined && bristle.lastY !== undefined) {
        this.paintCtx.beginPath();
        this.paintCtx.moveTo(bristle.lastX, bristle.lastY);
        this.paintCtx.lineTo(tipX, tipY);
        this.paintCtx.stroke();
      } else {
        this.paintCtx.beginPath();
        this.paintCtx.arc(tipX, tipY, width * 0.6, 0, Math.PI * 2);
        this.paintCtx.fillStyle = color;
        this.paintCtx.fill();
      }

      bristle.lastX = tipX;
      bristle.lastY = tipY;

      const depletion = (pressure * 0.015 + velocityClamped * 0.04) * (1 + solvent * 0.6);
      bristle.reservoir = Math.max(0, bristle.reservoir - depletion);

      if (this.useGpu && this.gpuDiffusion && this.gpuSupported && alpha > 0.02) {
        const sampleRadius = Math.max(width * 6, width * 2.5 + 6);
        this.queueGpuSample(tipX, tipY, sampleRadius, clamp01(alpha * 1.1), color, solvent);
      }
    }
    if (this.useGpu && this.pendingGpuSamples.length > MAX_GPU_STAGING) {
      this.stepGpuDiffusion();
    }
  }

  computeBristleColor(bristle, jitterGate, solvent) {
    const macro = this.settings.jitterMacro * jitterGate;
    if (!macro) return this.baseColor;
    const hueOffset = (bristle.colorSeed - 0.5) * 60 * macro;
    const valueBias = 1 + (bristle.valueSeed - 0.5) * 0.5 * macro;
    const raw = offsetHueValue(this.baseColor, hueOffset, valueBias);
    if (!solvent) return raw;
    return mixHex(raw, this.backgroundColor, solvent * 0.35);
  }

  requestBlit(force = false) {
    if (!this.active && !force) return;
    if (this.pendingBlit) {
      if (force) this.needsBlit = true;
      return;
    }
    this.pendingBlit = true;
    this.needsBlit = this.needsBlit || force;
    RAF(() => {
      this.pendingBlit = false;
      if (!this.active && !this.needsBlit) return;
      this.stepGpuDiffusion();
      this.blitToTarget();
      this.needsBlit = false;
    });
  }

  blitToTarget() {
    if (!this.targetCtx || !this.paintCanvas) return;
    const ctx = this.targetCtx;
    const canvas = ctx.canvas;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.paintCanvas, 0, 0);
    if (this.useGpu && this.gpuDiffusion && this.gpuSupported) {
      this.gpuDiffusion.resolveSmear(ctx, 0.82);
    }
    ctx.restore();
    if (this.overlayCtx) {
      this.overlayCtx.clearRect(0, 0, this.overlayCtx.canvas.width, this.overlayCtx.canvas.height);
    }
  }

  refreshFrame() {
    if (!this.active) return;
    this.requestBlit(true);
  }

  createBristleBundle() {
    const bundle = [];
    const count = Math.max(16, Math.floor(this.settings.bristleCount));
    const spread = this.settings.spread;
    const clump = this.settings.clump;
    const paintLoad = Math.max(0.1, this.settings.paintLoad);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 0.6 + clump * 1.8) * spread;
      const offsetX = Math.cos(angle) * radius;
      const offsetY = Math.sin(angle) * radius * (0.92 + Math.random() * 0.16);
      const reservoir = paintLoad * (0.6 + Math.random() * 0.5);
      bundle.push({
        baseX: offsetX,
        baseY: offsetY,
        springX: offsetX,
        springY: offsetY,
        initialReservoir: reservoir,
        reservoir,
        colorSeed: Math.random(),
        valueSeed: Math.random(),
        spacingSeed: Math.random(),
        shearSeed: (Math.random() - 0.5) * 2,
        flowSeed: 0.4 + Math.random() * 0.75,
      });
    }
    return bundle;
  }
}

let sharedEngine = null;

export function getExpressiveBrushEngine() {
  if (!sharedEngine) {
    sharedEngine = new ExpressiveBrushEngine();
  }
  return sharedEngine;
}

export function runExpressiveBrush({ canvas, ctx, controls, helpers }) {
  const engine = getExpressiveBrushEngine();
  engine.attachEnvironment({
    canvas,
    ctx,
    overlayCtx: helpers?.overlayCtx,
    controls,
    mapPoint: helpers?.mapPoint,
  });
  engine.refreshFrame();
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function hexToRgbFloat(hex) {
  if (typeof hex !== 'string') return [1, 1, 1];
  const normalized = hex.trim().replace('#', '');
  let r = 255;
  let g = 255;
  let b = 255;
  if (normalized.length === 3) {
    r = parseInt(normalized[0] + normalized[0], 16);
    g = parseInt(normalized[1] + normalized[1], 16);
    b = parseInt(normalized[2] + normalized[2], 16);
  } else if (normalized.length === 6) {
    r = parseInt(normalized.slice(0, 2), 16);
    g = parseInt(normalized.slice(2, 4), 16);
    b = parseInt(normalized.slice(4, 6), 16);
  }
  const inv = 1 / 255;
  return [r * inv, g * inv, b * inv];
}
