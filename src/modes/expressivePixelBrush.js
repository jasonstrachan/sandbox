import { offsetHueValue, mixHex } from '../utils/color.js';

const DEFAULT_SETTINGS = {
  spread: 26,
  clump: 0.35,
  solvent: 0.18,
  jitterMacro: 0.45,
  stiffness: 0.65,
  spacingJitter: 0.3,
  paintLoad: 0.8,
  bristleCount: 84,
  pixelSize: 4,
};

const RAF = typeof window !== 'undefined' && window.requestAnimationFrame
  ? window.requestAnimationFrame.bind(window)
  : (fn) => setTimeout(fn, 16);

class ExpressivePixelBrushEngine {
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
    this.settings.spread = readNumber('pxBrushSpread', DEFAULT_SETTINGS.spread);
    this.settings.clump = readNumber('pxBrushClump', DEFAULT_SETTINGS.clump);
    this.settings.solvent = readNumber('pxBrushSolvent', DEFAULT_SETTINGS.solvent);
    this.settings.jitterMacro = readNumber('pxBrushJitter', DEFAULT_SETTINGS.jitterMacro);
    this.settings.stiffness = readNumber('pxBrushStiffness', DEFAULT_SETTINGS.stiffness);
    this.settings.spacingJitter = readNumber('pxBrushSpacingJitter', DEFAULT_SETTINGS.spacingJitter);
    this.settings.paintLoad = readNumber('pxBrushPaintLoad', DEFAULT_SETTINGS.paintLoad);
    this.settings.pixelSize = clampRange(readNumber('pxBrushPixelSize', DEFAULT_SETTINGS.pixelSize), 1, 32);
    this.settings.bristleCount = DEFAULT_SETTINGS.bristleCount;
  }

  ensureSurface() {
    if (!this.paintCanvas || !this.canvas) return;
    if (this.paintCanvas.width === this.canvas.width && this.paintCanvas.height === this.canvas.height) return;
    const prev = this.paintCtx ? this.paintCtx.getImageData(0, 0, this.paintCanvas.width, this.paintCanvas.height) : null;
    this.paintCanvas.width = this.canvas.width;
    this.paintCanvas.height = this.canvas.height;
    this.paintCtx = this.paintCanvas.getContext('2d');
    if (this.paintCtx) {
      this.paintCtx.imageSmoothingEnabled = false;
      this.paintCtx.globalCompositeOperation = 'source-over';
      if (prev) this.paintCtx.putImageData(prev, 0, 0);
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
    this.requestBlit(true);
  }

  handlePointerDown(event) {
    if (!this.active || !this.paintCtx || typeof this.mapPoint !== 'function') return false;
    this.syncSettings();
    this.refreshPalette();
    const pos = this.mapPoint(event);
    const timeStamp = typeof event.timeStamp === 'number' ? event.timeStamp : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const pressureRaw = typeof event.pressure === 'number' ? event.pressure : 0.5;
    const pressure = pressureRaw > 0 ? pressureRaw : (event.pointerType === 'mouse' ? 0.45 : 0.05);
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
    this.resetBristleHistory();
    this.stroke = null;
    this.requestBlit();
    return true;
  }

  handlePointerCancel(event) {
    if (!this.stroke || event.pointerId !== this.stroke.pointerId) return false;
    this.resetBristleHistory();
    this.stroke = null;
    this.requestBlit();
    return true;
  }

  resetBristleHistory() {
    if (!this.stroke) return;
    for (const bristle of this.stroke.bristles) {
      if (!bristle) continue;
      delete bristle.lastGX;
      delete bristle.lastGY;
    }
  }

  stampBristles(pos, event, dt, { velocity = 0, isFirst = false } = {}) {
    if (!this.stroke || !this.paintCtx) return;
    const pressureRaw = typeof event.pressure === 'number' ? event.pressure : this.stroke.prevPressure || 0.5;
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
    const pixelSize = Math.max(1, Math.floor(this.settings.pixelSize));

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

      if (alpha <= 0.15) continue;

      const gx = Math.round(tipX / pixelSize);
      const gy = Math.round(tipY / pixelSize);

      if (bristle.lastGX !== undefined && bristle.lastGY !== undefined) {
        this.plotPixelLine(bristle.lastGX, bristle.lastGY, gx, gy, color, pixelSize);
      } else {
        this.fillPixel(gx, gy, color, pixelSize);
      }

      bristle.lastGX = gx;
      bristle.lastGY = gy;
      bristle.lastX = tipX;
      bristle.lastY = tipY;

      const depletion = (pressure * 0.015 + velocityClamped * 0.04) * (1 + solvent * 0.6);
      bristle.reservoir = Math.max(0, bristle.reservoir - depletion);
    }
    if (this.stroke) {
      this.stroke.prevPressure = pressure;
    }
  }

  plotPixelLine(x0, y0, x1, y1, color, pixelSize) {
    let gx0 = x0;
    let gy0 = y0;
    let gx1 = x1;
    let gy1 = y1;
    const dx = Math.abs(gx1 - gx0);
    const dy = Math.abs(gy1 - gy0);
    const sx = gx0 < gx1 ? 1 : -1;
    const sy = gy0 < gy1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      this.fillPixel(gx0, gy0, color, pixelSize);
      if (gx0 === gx1 && gy0 === gy1) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        gx0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        gy0 += sy;
      }
    }
  }

  fillPixel(gx, gy, color, pixelSize) {
    if (!this.paintCtx) return;
    const x = gx * pixelSize;
    const y = gy * pixelSize;
    if (x + pixelSize < 0 || y + pixelSize < 0 || x >= this.paintCanvas.width || y >= this.paintCanvas.height) return;
    this.paintCtx.globalAlpha = 1;
    this.paintCtx.fillStyle = color;
    this.paintCtx.fillRect(x, y, pixelSize, pixelSize);
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
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = this.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.paintCanvas, 0, 0);
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

export function getExpressivePixelBrushEngine() {
  if (!sharedEngine) {
    sharedEngine = new ExpressivePixelBrushEngine();
  }
  return sharedEngine;
}

export function runExpressivePixelBrush({ canvas, ctx, controls, helpers }) {
  const engine = getExpressivePixelBrushEngine();
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

function clampRange(value, min, max) {
  if (Number.isFinite(min) && value < min) return min;
  if (Number.isFinite(max) && value > max) return max;
  return value;
}
