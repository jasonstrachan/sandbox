const palette = ['#0c0d14', '#142033', '#1f3c4f', '#335c67', '#a0c1b8', '#f4d6cc'];

export const stratified = {
  id: 'stratified',
  title: 'Stratified Layers',
  description:
    'Animated sediment bands driven by fractal noise. Pointer pressure folds the strata to reveal glow seams.',
  tags: ['canvas', 'terrain', 'noise'],
  background: '#05060a',
  controls: [
    { key: 'bandCount', label: 'Bands', type: 'range', min: 8, max: 64, step: 1, value: 24 },
    { key: 'frequency', label: 'Frequency', type: 'range', min: 0.0008, max: 0.01, step: 0.0002, value: 0.003 },
    { key: 'waveSpeed', label: 'Wave Speed', type: 'range', min: 0.05, max: 1.5, step: 0.05, value: 0.4 },
    { key: 'persistence', label: 'Persistence', type: 'range', min: 0.7, max: 0.99, step: 0.01, value: 0.9 },
    { key: 'pointerInfluence', label: 'Pointer Push', type: 'range', min: 0, max: 1, step: 0.05, value: 0.35 },
    { key: 'glow', label: 'Glow', type: 'range', min: 0, max: 1, step: 0.05, value: 0.4 },
  ],
  create(env) {
    const state = {
      bandCount: 24,
      frequency: 0.003,
      waveSpeed: 0.4,
      persistence: 0.9,
      pointerInfluence: 0.35,
      glow: 0.4,
      pointer: null,
      time: 0,
    };

    const overlay = env.overlayCtx;

    const update = ({ ctx, dt }) => {
      if (!ctx) return;
      state.time += dt * state.waveSpeed;
      const { width, height } = env.size();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(5,6,10,0.12)';
      ctx.fillRect(0, 0, width, height);

      const step = 1.5;
      for (let y = 0; y < height; y += step) {
        const ny = y * state.frequency;
        const altitude = fbm2d(ny, state.time, { persistence: state.persistence, octaves: 4 });
        const pointerBoost = computePointerInfluence(state.pointer, y, height, state.pointerInfluence);
        const value = clamp01(altitude + pointerBoost);
        const bandIndex = Math.floor(value * state.bandCount);
        const t = bandIndex / Math.max(1, state.bandCount - 1);
        ctx.fillStyle = samplePalette(t);
        ctx.fillRect(0, y, width, step + 0.5);

        if (state.glow > 0 && bandIndex % 5 === 0) {
          ctx.globalCompositeOperation = 'screen';
          ctx.fillStyle = `rgba(249, 200, 140, ${0.08 * state.glow})`;
          ctx.fillRect(0, y, width, step * 2);
          ctx.globalCompositeOperation = 'source-over';
        }
      }

      if (overlay) {
        overlay.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);
        if (state.pointer) {
          overlay.strokeStyle = 'rgba(255,255,255,0.25)';
          overlay.lineWidth = 1;
          overlay.setLineDash([6, 10]);
          overlay.beginPath();
          overlay.moveTo(0, state.pointer.y);
          overlay.lineTo(overlay.canvas.width, state.pointer.y);
          overlay.stroke();
          overlay.setLineDash([]);
        }
      }
    };

    return {
      update,
      onPointer(event) {
        if (event.type === 'pointerup') {
          state.pointer = null;
        } else {
          state.pointer = { x: event.x, y: event.y };
        }
      },
      onControlChange(key, value) {
        state[key] = value;
      },
      destroy() {
        state.pointer = null;
        if (overlay) {
          overlay.clearRect(0, 0, overlay.canvas.width, overlay.canvas.height);
        }
      },
    };
  },
};

function samplePalette(t) {
  if (!Number.isFinite(t)) return palette[0];
  const scaled = clamp(t, 0, 1) * (palette.length - 1);
  const idx = Math.floor(clamp(scaled, 0, palette.length - 1));
  const frac = clamp01(scaled - idx);
  const a = hexToRgb(palette[idx]);
  const b = hexToRgb(palette[Math.min(idx + 1, palette.length - 1)]);
  const r = Math.round(lerp(a[0], b[0], frac));
  const g = Math.round(lerp(a[1], b[1], frac));
  const bCh = Math.round(lerp(a[2], b[2], frac));
  return `rgb(${r}, ${g}, ${bCh})`;
}

function computePointerInfluence(pointer, y, height, strength) {
  if (!pointer || strength <= 0) return 0;
  const relative = clamp01(Math.abs(pointer.y - y) / height);
  const falloff = Math.exp(-relative * 10);
  return falloff * strength * (pointer.y < y ? -0.5 : 0.5);
}

function fbm2d(x, y, { octaves = 4, persistence = 0.5, lacunarity = 2 } = {}) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let maxValue = 0;
  for (let i = 0; i < octaves; i += 1) {
    total += amplitude * noise2d(x * frequency, y * frequency);
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / maxValue;
}

function noise2d(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);

  const aa = hash(xi, yi);
  const ab = hash(xi, yi + 1);
  const ba = hash(xi + 1, yi);
  const bb = hash(xi + 1, yi + 1);

  const x1 = lerp(aa, ba, u);
  const x2 = lerp(ab, bb, u);
  return lerp(x1, x2, v);
}

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized.length === 3 ? normalized.repeat(2) : normalized, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
