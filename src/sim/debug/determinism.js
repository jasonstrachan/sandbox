const DEFAULT_STORAGE_KEY = 'stack-sim-golden';
const DEFAULT_SAVE_INTERVAL = 120;

export class DeterminismTracker {
  constructor(options = {}) {
    const normalized = normalizeOptions(options);
    this.storageKey = normalized.storageKey;
    this.recordGolden = normalized.recordGolden;
    this.saveInterval = normalized.saveInterval;
    this.framesSinceSave = 0;
    this.dirty = false;
    this.golden = this.loadGolden();
    this.diffs = [];
  }

  record(frame, values) {
    const hash = hashArray(values);
    const key = String(frame);
    const expected = this.golden[key];
    if (expected === undefined) {
      if (this.recordGolden) {
        this.golden[key] = hash;
        this.markDirty();
      }
    } else if (expected !== hash) {
      this.diffs.push({ frame, expected, actual: hash });
    }
    this.maybeSave();
    return hash;
  }

  exportGolden() {
    return { ...this.golden };
  }

  getDiffs() {
    return [...this.diffs];
  }

  loadGolden() {
    try {
      if (typeof window === 'undefined') return {};
      const raw = window.localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  flush() {
    this.maybeSave(true);
  }

  markDirty() {
    this.dirty = true;
  }

  maybeSave(force = false) {
    if (!this.recordGolden || !this.dirty) return;
    if (!force) {
      this.framesSinceSave += 1;
      if (this.framesSinceSave < this.saveInterval) return;
    }
    this.framesSinceSave = 0;
    this.dirty = false;
    this.saveGolden();
  }

  saveGolden() {
    if (!this.recordGolden) return;
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.golden));
    } catch (err) {
      /* ignore */
    }
  }
}

function normalizeOptions(options) {
  if (typeof options === 'string') {
    return { storageKey: options, recordGolden: false, saveInterval: DEFAULT_SAVE_INTERVAL };
  }
  const normalized = { ...options };
  return {
    storageKey: normalized.storageKey ?? DEFAULT_STORAGE_KEY,
    recordGolden: Boolean(normalized.recordGolden),
    saveInterval: Math.max(1, Math.floor(normalized.saveInterval ?? DEFAULT_SAVE_INTERVAL)),
  };
}

function hashArray(values) {
  let hash = 2166136261;
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]) || 0;
    const int = toUint32(Math.fround(value) * 1e5);
    hash ^= int;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toUint32(value) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  return view.getUint32(0);
}
