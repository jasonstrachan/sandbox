import { createSpawnArtifact } from '../sim/mesh/spawn.js';
import { renderArtifacts, renderDiagnostics } from '../sim/render/static-pass.js';
import { vec2 } from '../sim/math/vec2.js';
import { Xoshiro128 } from '../sim/rng/xoshiro128.js';

const STATIC_LAYOUT = [
  { shapeId: 'box-carton', anchor: [0.22, 0.22], scale: 1 },
  { shapeId: 'flat-mailer', anchor: [0.45, 0.2], scale: 0.9 },
  { shapeId: 'bottle-profile', anchor: [0.7, 0.26], scale: 1 },
  { shapeId: 'phone-slab', anchor: [0.18, 0.5], scale: 1 },
  { shapeId: 'irregular-shard', anchor: [0.42, 0.55], scale: 1.05 },
  { shapeId: 'handbag-tote', anchor: [0.7, 0.58], scale: 1 },
  { shapeId: 'bicycle-chunk', anchor: [0.3, 0.82], scale: 0.95 },
  { shapeId: 'skull-icon', anchor: [0.62, 0.8], scale: 1 },
];

export const v0StaticRender = {
  id: 'v0-0-static-render',
  title: 'v0.0 · Static Render Test',
  description:
    'Deterministic silhouettes rendered with shared canvas/world transform plus outline, lattice, and overlay diagnostics.',
  tags: ['spec', 'v0.0', 'canvas'],
  background: '#05060a',
  controls: [
    { key: 'showLattice', label: 'Show Lattice', type: 'checkbox', value: true },
    { key: 'showOverlay', label: 'Show Overlay', type: 'checkbox', value: true },
  ],
  create(env) {
    const state = {
      artifacts: [],
      lastSize: null,
      showLattice: true,
      showOverlay: true,
      rng: new Xoshiro128('v0.0-static'),
    };

    const buildScene = () => {
      const { width, height } = env.size();
      state.artifacts = STATIC_LAYOUT.map((item, index) => {
        const position = vec2(width * item.anchor[0], height * item.anchor[1]);
        const rng = state.rng.clone();
        rng.setSeed(`${item.shapeId}-${index}`);
        return createSpawnArtifact(
          {
            shapeId: item.shapeId,
            scale: item.scale,
            rotation: item.rotation ?? 0,
            position,
            id: `v0-static-${item.shapeId}-${index}`,
          },
          rng
        );
      });
      state.lastSize = { width, height };
    };

    buildScene();

    const update = ({ ctx }) => {
      if (!ctx) return;
      const size = env.size();
      if (!state.lastSize || size.width !== state.lastSize.width || size.height !== state.lastSize.height) {
        buildScene();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, size.width, size.height);
      renderArtifacts(ctx, state.artifacts, { showLattice: state.showLattice });
      if (state.showOverlay) renderDiagnostics(env.overlayCtx, state.artifacts);
      else env.overlayCtx?.clearRect?.(0, 0, size.width, size.height);
    };

    return {
      update,
      onControlChange(key, value) {
        if (key === 'showLattice') state.showLattice = Boolean(value);
        if (key === 'showOverlay') state.showOverlay = Boolean(value);
      },
      destroy() {
        state.artifacts = [];
      },
    };
  },
};
