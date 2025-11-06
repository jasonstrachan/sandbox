# Stratified Prototype Architecture

_Last updated: November 5, 2025_

## Module Overview

| Layer | Path | Responsibility |
| --- | --- | --- |
| Entry | `src/prototypes/stratified.js` | Thin composition layer that wires controller, pipeline, HUD, renderer, and WebGPU host plumbing. Maintains frame timing + camera scroll math only. |
| Controller | `src/stratified/controller.js` | Owns mutable state + persistence, mediates control updates/hotkeys, exposes imperative API (`togglePause`, `handleControlChange`, etc.) and emits status/contact events. |
| Pipeline | `src/stratified/pipeline.js` | Encapsulates simulation, renderer, strata, and factory objects. Provides `tick(dt)`, `rebuildArtifacts`, `spawnWave`, `recyclePool`, pool event logging, and metrics snapshots consumable by other layers. |
| HUD | `src/stratified/hud.js` | Pure overlay + diagnostics renderer. Consumes controller snapshot, pipeline metrics, and buffer stats to update the canvas overlay/`#hud-info` panel and build export manifests. |
| Helpers | `src/stratified/__tests__` | Node-based tests for controller persistence, pipeline pool management, and HUD manifest logic.

## Key APIs

### StratifiedController
- `getState()` → shared mutable snapshot for pipeline + entry.
- `handleControlChange(key, value, hooks)` → applies validation, triggers persistence, executes hooks (`recycleArtifactPool`, `requestPNGExport`, etc.).
- `syncControl(key, value)` → pushes values to the host without triggering another `handleControlChange`.
- `togglePause`, `toggleSlowMotion`, `forceBake`, `setStatus` → imperative helpers used by the entry/hotkeys.
- `applyPersistedControls()` → replays saved control state into the host UI on boot.

### StratifiedPipeline
- `tick(dt)` → advances spawn cadence + simulation accumulator, steps the simulation, collects metrics (`artifact`, `pool`, `contacts`, `timings`), and returns the latest snapshot.
- `rebuildArtifacts({ preserveStrata, fillMode })` → rebuilds the artifact pool either for respawns or seeded fills.
- `spawnWave()` / `recyclePool()` → handles incremental pool updates and manual recycling.
- `getMetrics()` / `getPoolSnapshot()` → expose immutable snapshots for HUD + diagnostics code.

### StratifiedHUD
- `createStratifiedHUD({ overlayCtx, infoPanel })` → returns `render({ state, fps, simStepMs, bufferStats, metrics, contactBuffers })` for drawing overlays/panels.
- `buildDiagnosticsSnapshot({ pipeline, simulation })` → produces the diagnostics section for export manifests.
- `buildPoolSnapshot(pipeline, state)` → returns the latest pool info (falls back to controller state when pipeline metrics are unavailable).
- `buildExportManifest({...})` → composes metadata, control snapshots, pipeline metrics, and diagnostics into the export manifest used by PNG/WebM downloads.

## Data Flow
1. **Controls/UI** → update events -> `StratifiedController.handleControlChange` → state mutations + persistence → pipeline sees changes via shared state.
2. **Frame Loop** (`stratified.js`) → `pipeline.tick(dt)` (simulation/pool) + camera math → `hud.render(...)` for overlays.
3. **Exports/Diagnostics** → `buildExportManifest` + `buildDiagnosticsSnapshot` to collect consistent metadata + metrics without touching simulation internals.

## Testing Notes
- `npm test` runs the Node test runner (`node --test`) and exercises controller persistence, pipeline pool logging, and HUD manifest helpers. Add new suites under `src/stratified/__tests__`.
- UI smoke tests still require `npm run dev` (manual), especially after manifest/export or renderer changes.

## Outstanding Work
- Capture baseline JSON manifest alongside `screenshots/image copy 8.png` for regression comparisons.
- Remove any residual helpers from `src/prototypes/stratified.js` that duplicate HUD logic (track in Phase 4 checklist).
