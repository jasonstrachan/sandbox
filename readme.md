# Sandbox Base

This branch is a fresh starting point for fast canvas/WebGL prototypes. It keeps the tooling (Vite + vanilla JS) but strips out previous experiments so every new idea starts from the same clean slate.

## Dev workflow

1. Install deps once: `npm install`
2. Run locally: `npm run dev`
3. Build for static hosting: `npm run build`

## Creating a new prototype branch

1. Make sure the base is up to date:
   ```bash
   git switch main
   git pull
   ```
2. Spin up a branch for your idea:
   ```bash
   git switch -c proto/<idea>
   ```
3. Edit files in `src/` (or clone the template in `src/prototypes`). Keep commits local to that branch.
4. Push/publish when you want to share:
   ```bash
   git push -u origin proto/<idea>
   ```
5. When the experiment is done, tag it or delete the branch—no merges back to `main` required.

## Runtime pieces

- `src/core/host.js` – wires canvases, the control panel, pointer events, and the RAF loop.
- `src/core/canvas.js` – DPI-aware helpers for 2D and WebGL contexts.
- `src/core/controls.js` – minimal UI renderer for sliders, colors, selects.
- `src/prototypes/*.js` – drop-in modules that expose `{ id, title, controls, create() }`.

See `docs/prototypes.md` for a deeper breakdown of the contract between the host and each prototype.

## Organic Strata Simulator (2025 build)

The `stack-simulator` prototype exercises the full v1.1 phased spec:

- XPBD soft bodies with stretch/area/bend constraints, ground contacts, and per-tier scheduling.
- Rectangular strata grid with depth-aware compaction, lateral creep, warp-aware rendering, and palette drift (hue from material + chroma/value from stress/age).
- Plasticity with unified β drift across stretch/area/bend, plus deterministic distance joints that can yield or break.
- Budget-aware scheduling (solver/grid/contacts timings vs. 4/2/3 ms targets) that dials back iterations and `N_max` when needed.
- Determinism tracker that hashes SoA buffers every frame; goldens persist via `localStorage` and can be diffed offline with `node scripts/replay-diff.js baseline.json sample.json`.
- Release soak harness: run `node scripts/soak-harness.js` to emit a deterministic spawn schedule (`dist/soak-schedule.json`) that you can feed into the sim for overnight runs to check color drift and compaction tiers on target hardware.

Use the new controls to toggle auto-spawn, warp overlays, profiling scenes (1/4/8 meshes), damping/plastic β, and diagnostics overlays. Residual RMS and timing HUD values render on the overlay canvas so you can monitor stability in real time.
