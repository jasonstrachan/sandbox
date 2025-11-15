const DEFAULT_ATTACHMENT_STIFFNESS = 0.02;
const DEFAULT_ATTACHMENT_DAMPING = 0.5;
const DEFAULT_ATTACHMENT_EPSILON = 1e-3;

export class StrataGrid {
  constructor({ width, height, cellSize = 32 } = {}) {
    this.cellSize = cellSize;
    this.maxDeltaMass = 60;
    this.massToHeight = 0.02;
    this.maxDeltaHeight = 14;
    this.downshiftScale = 0.35;
    this.stressScale = 0.015;
    this.creepIterations = 3;
    this.creepRate = 0.25;
    this.attachmentStiffness = DEFAULT_ATTACHMENT_STIFFNESS;
    this.attachmentDamping = DEFAULT_ATTACHMENT_DAMPING;
    this.attachmentEpsilon = DEFAULT_ATTACHMENT_EPSILON;
    this.resize(width ?? 1024, height ?? 768);
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.columnCount = Math.max(1, Math.ceil(this.width / this.cellSize));
    this.columns = Array.from({ length: this.columnCount }, () => createColumn());
    this.maxDownshift = this.height * 0.35;
  }

  beginFrame() {
    this.columns.forEach((column) => {
      column.incomingMass = 0;
    });
  }

  accumulateFromArtifacts(artifacts = []) {
    artifacts.forEach((artifact) => {
      artifact.particles.forEach((particle) => {
        if (!particle.boundary) return;
        const colIndex = clampIndex(Math.floor(particle.position.x / this.cellSize), this.columnCount);
        const column = this.columns[colIndex];
        column.incomingMass += particle.mass || 0;
      });
    });
  }

  finalize() {
    this.maxStress = 0;
    this.columns.forEach((column) => {
      const deltaMass = clamp(column.incomingMass - column.mass, -this.maxDeltaMass, this.maxDeltaMass);
      column.mass += deltaMass;
      const targetHeight = Math.min(this.height, column.mass * this.massToHeight);
      const deltaHeight = clamp(targetHeight - column.height, -this.maxDeltaHeight, this.maxDeltaHeight);
      column.height += deltaHeight;
      const nextDownshift = clamp(column.downshift + deltaHeight * this.downshiftScale, 0, this.maxDownshift);
      column.downshift = nextDownshift;
      column.pendingShift = nextDownshift - column.downshiftApplied;
      column.surface = this.height - column.height;
      const stressTarget = column.mass * this.stressScale;
      column.stress += (stressTarget - column.stress) * 0.35;
      column.sigma = column.stress;
      if (column.sigma > this.maxStress) this.maxStress = column.sigma;
    });
    this.applyCreep();
    this.smoothSurfaceProfile();
  }

  applyAttachments(artifacts = []) {
    if (!this.columns?.length || !artifacts?.length) return;
    const epsilon = this.attachmentEpsilon;
    const damping = this.attachmentDamping;
    artifacts.forEach((artifact) => {
      if (!artifact) return;
      const coupling = artifact.material?.gridCouplingScale ?? 1;
      if (!artifact.particles?.length) return;
      if (coupling <= 0) return;
      const weight = clamp01(artifact.attachmentWeight ?? 0);
      if (weight <= 0) return;
      const stiffness = this.attachmentStiffness * coupling * weight;
      artifact.particles.forEach((particle) => {
        if (!particle || !particle.boundary) return;
        if (particle.invMass === 0) return;
        const targetY = this.sampleSmoothedSurface(particle.position.x);
        if (!Number.isFinite(targetY)) return;
        const dy = targetY - particle.position.y;
        if (dy <= epsilon) return;
        const deltaY = dy * stiffness;
        if (Math.abs(deltaY) <= epsilon) return;
        particle.position.y += deltaY;
        if (particle.prevPosition) {
          particle.prevPosition.y += deltaY * damping;
        }
      });
    });
    this.columns.forEach((column) => {
      column.downshiftApplied = column.downshift;
      column.pendingShift = 0;
    });
  }

  sampleDownshift(x) {
    const colIndex = clampIndex(Math.floor(x / this.cellSize), this.columnCount);
    return this.columns[colIndex]?.downshift ?? 0;
  }

  sampleDownshiftDelta(x) {
    const colIndex = clampIndex(Math.floor(x / this.cellSize), this.columnCount);
    return this.columns[colIndex]?.pendingShift ?? 0;
  }

  sampleStress(x) {
    const colIndex = clampIndex(Math.floor(x / this.cellSize), this.columnCount);
    return this.columns[colIndex]?.sigma ?? 0;
  }

  sampleSmoothedSurface(x) {
    const colIndex = clampIndex(Math.floor(x / this.cellSize), this.columnCount);
    const column = this.columns[colIndex];
    if (!column) return null;
    return column.smoothedSurface ?? column.surface ?? this.height;
  }

  sampleSurfaceRange(minX, maxX) {
    const start = clampIndex(Math.floor(minX / this.cellSize), this.columnCount);
    const end = clampIndex(Math.floor(maxX / this.cellSize), this.columnCount);
    let total = 0;
    let count = 0;
    for (let i = start; i <= end; i += 1) {
      total += this.columns[i]?.surface ?? this.height;
      count += 1;
    }
    return count ? total / count : this.height;
  }

  getColumns() {
    return this.columns;
  }

  applyCreep() {
    if (this.creepIterations <= 0) return;
    for (let iter = 0; iter < this.creepIterations; iter += 1) {
      for (let i = 1; i < this.columns.length - 1; i += 1) {
        const left = this.columns[i - 1];
        const current = this.columns[i];
        const right = this.columns[i + 1];
        const neighborAvg = (left.height + right.height) * 0.5;
        const delta = (neighborAvg - current.height) * this.creepRate;
        current.height = clamp(current.height + delta, 0, this.height);
        current.surface = this.height - current.height;
      }
    }
  }

  smoothSurfaceProfile() {
    if (!this.columns?.length) return;
    const count = this.columns.length;
    const maxTarget = this.height + (this.maxDownshift ?? 0);
    if (count === 1) {
      const column = this.columns[0];
      const surface = column.surface ?? this.height;
      const downshift = column.downshift ?? 0;
      column.smoothedSurface = clamp(surface + downshift, 0, maxTarget);
      return;
    }
    const smoothed = new Array(count);
    const last = count - 1;
    const surfaces = this.columns.map((column) => {
      const surface = column.surface ?? this.height;
      const downshift = column.downshift ?? 0;
      return clamp(surface + downshift, 0, maxTarget);
    });
    smoothed[0] = (surfaces[0] + surfaces[1]) * 0.5;
    smoothed[last] = (surfaces[last] + surfaces[last - 1]) * 0.5;
    for (let i = 1; i < last; i += 1) {
      const prev = surfaces[i - 1];
      const curr = surfaces[i];
      const next = surfaces[i + 1];
      smoothed[i] = (prev + 2 * curr + next) * 0.25;
    }
    for (let i = 0; i < count; i += 1) {
      this.columns[i].smoothedSurface = clamp(smoothed[i], 0, maxTarget);
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampIndex(index, length) {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(length - 1, index));
}

function createColumn() {
  return {
    mass: 0,
    incomingMass: 0,
    height: 0,
    downshift: 0,
    downshiftApplied: 0,
    pendingShift: 0,
    surface: 0,
    smoothedSurface: 0,
    stress: 0,
    sigma: 0,
  };
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
