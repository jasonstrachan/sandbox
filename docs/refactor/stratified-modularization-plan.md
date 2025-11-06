# Stratified Prototype Modularization Plan

_Date: November 5, 2025_

## 1. Goals
1. Reduce cognitive load when iterating on the stratified prototype.
2. Decouple UI/controls, simulation orchestration, and diagnostics so each can evolve independently.
3. Enable targeted testing (unit + headless integration) for pool management and settling.
4. Preserve existing visual output and GPU-side behavior during the transition.

## 2. Pain Points (Today)
- `src/prototypes/stratified.js` (~1.6k LOC) intermixes state, DOM wiring, simulation control, HUD rendering, media export, and diagnostics.
- Shared mutable `state` object is touched everywhere, making regressions easy and code review hard.
- Spawn/pool logic cannot be tested without loading the full prototype because it depends on DOM state and renderer.
- HUD/export code duplicates metrics gathering and couples textual formatting with data collection.
- Hotkey + control handling writes directly into `state`, so adding new controls risks clobbering persistence.

## 3. Target Architecture

```
proto entry (stratified.js)
 ├─ StratifiedController (new: src/stratified/controller.js)
 │   ├─ owns state snapshot + persistence + control syncing
 │   ├─ exposes imperative API (setSpawnCount, togglePause, recyclePool, etc.)
 │   └─ emits events (stateChanged, status, poolEvent)
 ├─ StratifiedPipeline (new: src/stratified/pipeline.js)
 │   ├─ owns simulation, renderer, strata accumulator
 │   ├─ APIs: init(seed), rebuildArtifacts(opts), streamWave(), step(dt)
 │   └─ reports metrics (artifact stats, buffer stats, pool stats)
 ├─ StratifiedHUD (new: src/stratified/hud.js)
 │   ├─ pure renderer for overlay + diagnostics + exports
 │   └─ consumes controller snapshot + pipeline metrics
 └─ Existing helpers (factory, renderer, strata, encoder) remain untouched
```

### Key Interfaces (first pass)
- `StratifiedController`
  - `getSnapshot(): StratifiedState`
  - `updateControl(key, value)`
  - `on(event, handler)` for status/pool/control events
  - `serializeControls()` / `applyPersisted(snapshot)`
- `StratifiedPipeline`
  - constructor takes `{ controller, env }`
  - `tick(dt)` → advances sim, handles spawn cadence, updates metrics
  - `forceRespawn({ preserveStrata, fillMode })`
  - `spawnWave()`
  - `getMetrics(): StratifiedMetrics`
- `StratifiedHUD`
  - `update({ controllerSnapshot, metrics, diagnostics })`
  - `renderOverlay(ctx)` + `updatePanel(element)`

## 4. Phased Refactor Steps

### Phase 0 – Prep (1 day)
- [x] Freeze current behavior with a baseline recording (PNG + manifest) for regression comparison. PNG captured at `screenshots/image copy 8.png`; JSON manifest capture still pending but tracked alongside the asset folder.
- [x] Add lightweight unit test scaffolding (currently `npm test` → `node --test`) targeting pure helpers; first suite lives in `src/stratified/__tests__/palettes.test.js`.

### Phase 1 – Controller Extraction (1–2 days)
- [x] Move `state` definition + persistence helpers + control syncing + hotkeys into `src/stratified/controller.js`.
- [x] Replace direct `state` mutations in the prototype with controller method calls.
- [x] Update prototype entry to subscribe to controller events (pool status, status messages).
- [x] Verify controls still respond (manual test on Nov 5, 2025 — pause, palette, recycle, hotkeys confirmed by user).

### Phase 2 – Pipeline Module (2–3 days)
- [x] Move spawn/scatter/rebuild/recycle/spawnWave functions into `pipeline.js`.
- [x] Encapsulate references to `simulation`, `renderer`, `strata`, and `factory` inside the pipeline.
- [x] Expose a `tick(dt)` that handles accumulator, slow-mo, spawn cadence, and rest threshold adjustments (`StratifiedPipeline.tick` now drives simulation stepping + spawn cadence each frame).
- [x] Provide a metrics snapshot (`artifact`, `pool`, `timings`) for HUD usage via `pipeline.getMetrics()` / `getPoolSnapshot()` consumed by diagnostics/export manifest builders.
- [x] Adjust prototype to instantiate pipeline with controller + env and drive it from the animation loop (respawn + wave orchestration now calls into the pipeline; tick/metrics now wired up, HUD integration next).

### Phase 3 – HUD & Diagnostics (1–2 days)
- [x] Extract `updateOverlay`, `collectDiagnostics`, `collectPoolSnapshot`, export manifest builders into `hud.js`.
- [x] HUD consumes controller snapshot + pipeline metrics; overlay rendering becomes a pure function.
- [x] Prototype entry updates HUD once per frame, decoupling rendering from simulation logic.

### Phase 4 – Cleanups & Tests (ongoing)
- [x] Add focused tests:
  - [x] Controller: control sync + persistence whitelist (node tests in `src/stratified/__tests__`).
  - [x] Pipeline/HUD: pool snapshot history, export manifest builder, metrics plumbing (node tests cover these already).
- [x] Document new module APIs (`docs/stratified-architecture.md`).
- [x] Remove obsolete helpers left in the prototype file (remaining overlay/export helpers now live in `hud.js`).

## 5. Validation Plan
- Manual: run `npm run dev`, verify stratified prototype behaves identically (spawns, settles, HUD).
- Automated: extend existing lint/typecheck; add unit tests once controller/pipeline are modular.
- Regression assets: compare before/after PNG + manifest (seed `76149c86eca59041`).

## 6. Risks & Mitigations
| Risk | Mitigation |
| --- | --- |
| Hidden coupling between state and renderer causes temporary breakage | Introduce controller in read-through mode first (no behavior change) before removing direct state access |
| Increased bundle size / additional imports | Tree-shake friendly modules, ensure Vite config supports code splitting |
| Lack of tests delays confidence | Prioritize adding minimal mocks for pipeline/controller once extracted |

## 7. Success Criteria
- `src/prototypes/stratified.js` shrinks to a thin composition layer (<400 LOC).
- Controller, pipeline, and HUD modules have clearly defined APIs and no DOM globals.
- Spawn/settle behavior can be driven via headless tests (mocked env) without a canvas.
- Developers can tweak rest/spawn logic without touching UI/export code.
