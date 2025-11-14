export function renderStack(ctx, artifacts, options = {}) {
  if (!ctx) return;
  const opts = {
    showWire: options.showWire ?? true,
    showParticles: options.showParticles ?? true,
    showAreaResiduals: options.showAreaResiduals ?? true,
    warp: options.warp ?? null,
    showJoints: options.showJoints ?? true,
    showTierBadges: options.showTierBadges ?? true,
  };

  artifacts.forEach((artifact) => {
    if (opts.showAreaResiduals) drawAreaResiduals(ctx, artifact, opts.warp);
    if (opts.showWire) drawWire(ctx, artifact, opts.warp);
    if (opts.showJoints) drawJoints(ctx, artifact, opts.warp);
    if (opts.showParticles) drawParticles(ctx, artifact, opts.warp);
  });

  if (opts.showTierBadges) {
    artifacts.forEach((artifact) => drawTierBadge(ctx, artifact, opts.warp));
  }
}

export function renderDebugOverlay(ctx, artifacts, options = {}) {
  if (!ctx) return;
  const warp = options.warp ?? null;
  if (options.showStretchResiduals) {
    artifacts.forEach((artifact) => drawStretchResiduals(ctx, artifact, warp));
  }
  if (options.showBendResiduals) {
    artifacts.forEach((artifact) => drawBendResiduals(ctx, artifact, warp));
  }
}

export function renderStrataGrid(ctx, grid, options = {}) {
  if (!ctx || !grid) return;
  const columns = grid.getColumns?.() ?? [];
  if (!columns.length) return;
  const hue = options.baseHue ?? 32;
  const warp = options.warp ?? null;
  ctx.save();
  columns.forEach((column, index) => {
    const height = Math.min(grid.height, column.height);
    if (height <= 0.5) return;
    const depth = clamp01(height / grid.height);
    const x = index * grid.cellSize;
    const y = grid.height - height;
    const saturation = 35 + depth * 25;
    const lightness = 15 + depth * 35;
    ctx.fillStyle = `hsla(${hue - depth * 18}, ${saturation}%, ${lightness}%, 0.55)`;
    if (!warp) {
      ctx.fillRect(x, y, grid.cellSize + 1, height);
    } else {
      drawWarpedQuad(ctx, warp, x, y, grid.cellSize, height);
    }
  });
  ctx.restore();
}

export function renderGridOverlay(ctx, grid, options = {}) {
  if (!ctx || !grid) return;
  const columns = grid.getColumns?.() ?? [];
  if (!columns.length) return;
  const warp = options.warp ?? null;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  columns.forEach((column, index) => {
    const x = index * grid.cellSize + grid.cellSize * 0.5;
    const y = column.surface;
    const point = warp ? warp.sample(x, y) : { x, y };
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  columns.forEach((column, index) => {
    if (column.stress <= 0) return;
    const intensity = clamp01(column.stress * 0.1);
    ctx.fillStyle = `rgba(255, 120, 80, ${intensity * 0.5})`;
    const barHeight = 8 + intensity * 18;
    const x = index * grid.cellSize + grid.cellSize * 0.35;
    const y = column.surface - barHeight - 2;
    if (!warp) ctx.fillRect(x, y, grid.cellSize * 0.3, barHeight);
    else drawWarpedQuad(ctx, warp, x, y, grid.cellSize * 0.3, barHeight);
  });
  ctx.restore();
}

export function renderRemnants(ctx, remnants, options = {}) {
  if (!ctx || !remnants?.length) return;
  const warp = options.warp ?? null;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  remnants.forEach((remnant) => {
    const outline = remnant.outline;
    if (!outline?.length) return;
    ctx.beginPath();
    outline.forEach((point, index) => {
      const projected = projectPoint(point, warp);
      if (index === 0) ctx.moveTo(projected.x, projected.y);
      else ctx.lineTo(projected.x, projected.y);
    });
    ctx.closePath();
    ctx.stroke();
  });
  ctx.restore();
}

export function renderWarpVectors(ctx, warp, options = {}) {
  if (!ctx || !warp) return;
  const samples = options.samples ?? 10;
  const vectors = warp.vectorField(samples);
  ctx.save();
  ctx.strokeStyle = 'rgba(120,180,255,0.45)';
  ctx.lineWidth = 1;
  vectors.forEach((vector) => {
    const tail = warp.sample(vector.x, vector.y);
    const head = { x: tail.x + vector.dx, y: tail.y + vector.dy };
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawWire(ctx, artifact, warp) {
  const particles = artifact.particles;
  const edges = artifact.topology.stretch;
  ctx.save();
  ctx.globalAlpha *= artifact.opacity ?? 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  edges.forEach((edge) => {
    const a = projectParticle(particles[edge.i0], warp);
    const b = projectParticle(particles[edge.i1], warp);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawJoints(ctx, artifact, warp) {
  const joints = artifact.topology.joints ?? [];
  if (!joints.length) return;
  ctx.save();
  ctx.globalAlpha *= artifact.opacity ?? 1;
  ctx.strokeStyle = 'rgba(255, 200, 80, 0.8)';
  ctx.lineWidth = 2;
  joints.forEach((joint) => {
    if (joint.broken) return;
    const a = projectParticle(artifact.particles[joint.i0], warp);
    const b = projectParticle(artifact.particles[joint.i1], warp);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawParticles(ctx, artifact, warp) {
  ctx.save();
  ctx.globalAlpha *= artifact.opacity ?? 1;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  artifact.particles.forEach((particle) => {
    const projected = projectParticle(particle, warp);
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, 2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawAreaResiduals(ctx, artifact, warp) {
  const triangles = artifact.topology.areas;
  const particles = artifact.particles;
  const residuals = artifact.debug.areaResiduals;
  ctx.save();
  triangles.forEach((tri, index) => {
    const p0 = projectParticle(particles[tri.indices[0]], warp);
    const p1 = projectParticle(particles[tri.indices[1]], warp);
    const p2 = projectParticle(particles[tri.indices[2]], warp);
    const rest = tri.restArea || 1;
    const residual = Math.min(residuals[index] / Math.abs(rest), 1);
    ctx.globalAlpha = Math.min(1, (artifact.opacity ?? 1) * (0.3 + residual * 0.4));
    ctx.fillStyle = artifact.renderColor ?? 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
}

function drawStretchResiduals(ctx, artifact, warp) {
  const particles = artifact.particles;
  const stretch = artifact.topology.stretch;
  const shear = artifact.topology.shear;
  const residuals = artifact.debug.stretchResiduals;
  ctx.save();
  ctx.globalAlpha *= artifact.opacity ?? 1;
  ctx.lineWidth = 1.5;
  let cursor = 0;
  const drawEdge = (edge) => {
    const residual = Math.min(residuals[cursor] / (edge.restLength || 1), 1);
    // Residual is the unsatisfied stretch stress: low → cyan, high → pink.
    const r = Math.floor(40 + residual * 210);
    const g = Math.floor(200 - residual * 160);
    ctx.strokeStyle = `rgba(${r}, ${g}, 160, 0.9)`;
    const a = projectParticle(particles[edge.i0], warp);
    const b = projectParticle(particles[edge.i1], warp);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    cursor += 1;
  };
  stretch.forEach(drawEdge);
  shear.forEach(drawEdge);
  ctx.restore();
}

function drawBendResiduals(ctx, artifact, warp) {
  const particles = artifact.particles;
  const bends = artifact.topology.bends ?? [];
  if (!bends.length) return;
  const residuals = artifact.debug.bendResiduals;
  ctx.save();
  ctx.globalAlpha *= artifact.opacity ?? 1;
  bends.forEach((bend, index) => {
    const residual = Math.min(residuals[index] / (Math.hypot(bend.rest.x, bend.rest.y) + 1), 1);
    const hue = 120 - residual * 120;
    ctx.strokeStyle = `hsla(${hue}, 80%, 60%, 0.8)`;
    ctx.lineWidth = 1;
    const mid = projectParticle(particles[bend.iMid], warp);
    const radius = 8;
    ctx.beginPath();
    ctx.arc(mid.x, mid.y, radius, 0, Math.PI * residual);
    ctx.stroke();
  });
  ctx.restore();
}

const TIER_VISUALS = {
  active: { label: 'A', fill: 'rgba(120,200,255,0.95)', stroke: 'rgba(8,24,40,0.9)', text: '#04121a' },
  resting: { label: 'S', fill: 'rgba(255,210,120,0.95)', stroke: 'rgba(46,26,4,0.9)', text: '#1b1104' },
  buried: { label: 'B', fill: 'rgba(210,150,255,0.95)', stroke: 'rgba(46,16,80,0.9)', text: '#1a082a' },
  default: { label: '?', fill: 'rgba(200,200,200,0.9)', stroke: 'rgba(20,20,20,0.85)', text: '#050505' },
};

function drawTierBadge(ctx, artifact, warp) {
  const tier = artifact.tier ?? 'active';
  const style = TIER_VISUALS[tier] ?? TIER_VISUALS.default;
  const bounds = artifact.bounds;
  let center;
  if (bounds) {
    center = { x: bounds.minX + bounds.width * 0.5, y: bounds.minY + bounds.height * 0.5 };
  } else if (artifact.particles?.length) {
    const particle = artifact.particles[0];
    center = { x: particle.position.x, y: particle.position.y };
  } else {
    center = { x: 0, y: 0 };
  }
  const projected = warp ? warp.sample(center.x, center.y) : center;
  const reference = Math.max(bounds?.width ?? 0, bounds?.height ?? 0);
  const radius = Math.max(12, Math.min(reference * 0.12 || 18, 28));
  ctx.save();
  ctx.globalAlpha = Math.min(1, (artifact.opacity ?? 1) * 0.95);
  ctx.fillStyle = style.fill;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = style.text;
  ctx.font = `bold ${Math.round(radius * 1.1)}px "IBM Plex Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(style.label, projected.x, projected.y + 1);
  ctx.restore();
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function drawWarpedQuad(ctx, warp, x, y, width, height) {
  const corners = [
    warp.sample(x, y),
    warp.sample(x + width, y),
    warp.sample(x + width, y + height),
    warp.sample(x, y + height),
  ];
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.fill();
}

function projectParticle(particle, warp) {
  if (!particle) return { x: 0, y: 0 };
  return warp ? warp.sample(particle.position.x, particle.position.y) : particle.position;
}

function projectPoint(point, warp) {
  if (!point) return { x: 0, y: 0 };
  return warp ? warp.sample(point.x, point.y) : point;
}
