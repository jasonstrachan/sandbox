# Stratified Lab

This branch is a fresh starting point for fast canvas/WebGL prototypes. It keeps the tooling (Vite + vanilla JS) but strips out previous experiments so every new idea starts from the same clean slate.

## Dev workflow

1. Install deps once: `npm install`
2. Run locally: `npm run dev`
3. If Vite ever looks "stuck" on an old bundle, wipe its cache and restart with `npm run dev:clean` (deletes `node_modules/.vite` and re-bundles dependencies with `--force`).
4. Build for static hosting: `npm run build` (or `npm run preview:prod` to build *and* serve the hashed output).
5. When you need to blow away old artifacts, use `npm run clean`.
6. Optional WGSL lint: `npm run lint:wgsl` (requires `wgsl_analyzer` or `naga` on your PATH)

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

### Live-build instrumentation & reset flow

- The HUD now prints `Build: <version@timestamp>` on the first line (derived from `package.json` + page load time). If that timestamp didn’t change after a refresh, you’re still staring at the old bundle.
- A developer-only `Factory Reset` action sits under the stratified controls. Clicking it wipes `localStorage['stratified.controls']` and reloads the page so the new defaults immediately apply.
- Prefer that button (or DevTools → Application → Storage → “Clear site data”) instead of hunting through storage keys by hand.

See `docs/prototypes.md` for a deeper breakdown of the contract between the host and each prototype.

## Stratified prototype cheat sheet

- **WebGPU baseline**: Chrome 129+ or Edge Canary with `shader-f16`, `timestamp-query`, and `texture-compression-bc` available. The host automatically requests those optional features; fallback text appears if the adapter is missing any requirements.
- **Controls**: everything in the picker persists between sessions (spawn count, camera bias, strata tuning, etc.). Developer-only sliders remain inside the collapsible “Developer” panel so public demos can hide them entirely.
- **Seed panel**: copy/reset/randomize buttons plus “Load Manifest” for piping a previously exported JSON back into the running prototype. Loading a manifest reapplies the seed and all persisted controls.
- **HUD + hotkeys**: overlay now lists FPS, sim timings, VRAM estimates, contact counts, and active vs. settled artifacts. Hotkeys—Space toggles pause, `S` toggles slow motion, `B` force-bakes strata, `D` dumps the last contact batch to the console.
- **Exports**:
  - PNG captures include a manifest sidecar describing the seed, control snapshot, texture sizes, shader hashes, and WebGPU feature set.
  - WebM capture prefers WebCodecs + VP9 (ImageBitmap → `VideoEncoder` → custom WebM muxer). When WebCodecs aren’t available, the code falls back to `MediaRecorder`. Each run auto-stops after ~8 seconds and writes the same manifest format as PNG.
- **Autosave / reset**: every persisted control (spawn count, gravity, damping, rest threshold, etc.) is mirrored into `localStorage` so tweaks survive refreshes. The new `Factory Reset` control wipes that storage and reloads when you want a clean slate without touching DevTools.
- **Pool guard**: the overlay shows `Pool <active>/<max>` plus the last pool event; when it reads `— paused`, spawn waves are suppressed because the artifact pool is full. Use the dev-only `Recycle Pool` toggle or raise `maxArtifacts` to free space. Export manifests now include the pool event log so field captures record every suppression/recycle.
- **Validation**: see `docs/validation-report.md` for the scenario checklist (single-box drop, mixed rain, long-haul, and 4K/120 Hz profiling). Populate that file with your local metrics + manifests before sharing captures outside the team.

## CI notes

- `npm run lint` runs both ESLint and WGSL validation. Make sure either [`wgsl_analyzer`](https://github.com/wgsl-analyzer/wgsl-analyzer) or [`naga`](https://github.com/gfx-rs/naga) is installed on the CI runner before invoking the script so shader validation does not silently downgrade to a no-op.
