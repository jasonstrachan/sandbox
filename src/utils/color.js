const clamp01 = (value) => {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const hexToRgb = (hex) => {
  const normalized = hex.replace('#', '');
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return { r, g, b };
  }
  if (normalized.length !== 6) return { r: 0, g: 0, b: 0 };
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { r, g, b };
};

const rgbToHex = (r, g, b) => {
  const toHex = (value) => {
    const clamped = Math.max(0, Math.min(255, Math.round(value)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const rgbToHsv = (r, g, b) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta > 1e-5) {
    if (max === rn) {
      h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
    } else if (max === gn) {
      h = ((bn - rn) / delta + 2) * 60;
    } else {
      h = ((rn - gn) / delta + 4) * 60;
    }
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s, v };
};

const hsvToRgb = (h, s, v) => {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;

  let rp = 0;
  let gp = 0;
  let bp = 0;

  if (hh < 60) {
    rp = c;
    gp = x;
  } else if (hh < 120) {
    rp = x;
    gp = c;
  } else if (hh < 180) {
    gp = c;
    bp = x;
  } else if (hh < 240) {
    gp = x;
    bp = c;
  } else if (hh < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }

  return {
    r: (rp + m) * 255,
    g: (gp + m) * 255,
    b: (bp + m) * 255,
  };
};

export const hexToHsv = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r, g, b);
};

export const hsvToHex = (h, s, v) => {
  const clampedH = ((h % 360) + 360) % 360;
  const clampedS = clamp01(s);
  const clampedV = clamp01(v);
  const { r, g, b } = hsvToRgb(clampedH, clampedS, clampedV);
  return rgbToHex(r, g, b);
};

export const mixHex = (hexA, hexB, t) => {
  const { r: rA, g: gA, b: bA } = hexToRgb(hexA);
  const { r: rB, g: gB, b: bB } = hexToRgb(hexB);
  const mix = (a, b) => a + (b - a) * clamp01(t);
  return rgbToHex(mix(rA, rB), mix(gA, gB), mix(bA, bB));
};

export const offsetHueValue = (hex, hueOffset, valueMul) => {
  const { h, s, v } = hexToHsv(hex);
  const newHue = h + hueOffset;
  const newValue = clamp01(v * valueMul);
  return hsvToHex(newHue, s, newValue);
};

