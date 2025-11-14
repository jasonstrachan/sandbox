import { bbox } from '../math/vec2.js';

export function renderArtifacts(ctx, artifacts, options = {}) {
  if (!ctx || !artifacts?.length) return;
  const { showLattice = true } = options;

  artifacts.forEach((artifact) => {
    drawSilhouette(ctx, artifact);
    if (showLattice) drawLattice(ctx, artifact);
  });
}

function drawSilhouette(ctx, artifact) {
  const { outline, palette } = artifact;
  if (!outline?.length) return;
  ctx.save();
  ctx.beginPath();
  outline.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.fillStyle = palette?.fill ?? 'rgba(255,255,255,0.08)';
  ctx.strokeStyle = palette?.stroke ?? 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLattice(ctx, artifact) {
  const particles = artifact.particles ?? [];
  const stretch = artifact.topology?.stretch ?? [];
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  stretch.forEach((edge) => {
    const a = particles[edge.i0];
    const b = particles[edge.i1];
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a.position.x, a.position.y);
    ctx.lineTo(b.position.x, b.position.y);
    ctx.stroke();
  });

  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  particles.forEach((particle) => {
    ctx.beginPath();
    ctx.arc(particle.position.x, particle.position.y, 2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

export function renderDiagnostics(overlayCtx, artifacts) {
  if (!overlayCtx || !artifacts?.length) return;
  overlayCtx.save();
  overlayCtx.clearRect(0, 0, overlayCtx.canvas.width, overlayCtx.canvas.height);
  artifacts.forEach((artifact) => {
    drawAabb(overlayCtx, artifact);
    drawCentroid(overlayCtx, artifact);
  });
  overlayCtx.restore();
}

function drawAabb(ctx, artifact) {
  const bounds = artifact.bounds ?? bbox(artifact.outline);
  ctx.strokeStyle = 'rgba(121, 210, 255, 0.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
  ctx.setLineDash([]);
}

function drawCentroid(ctx, artifact) {
  const center = artifact.centroid;
  if (!center) return;
  ctx.fillStyle = 'rgba(255, 238, 0, 0.6)';
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(center.x - 6, center.y);
  ctx.lineTo(center.x + 6, center.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(center.x, center.y - 6);
  ctx.lineTo(center.x, center.y + 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(center.x, center.y, 2, 0, Math.PI * 2);
  ctx.fill();
}
