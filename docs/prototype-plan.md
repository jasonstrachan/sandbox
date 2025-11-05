# Stratified Time — Prototype Implementation Plan

## 1. Project Skeleton (Day 0–1)
- [x] Audit `src/core/host.js`, `loop.js`, and current prototype mounting to map out lifecycle hooks (init, update, destroy).
- [x] Add WebGPU feature gate: prompt fallback text if adapter/device request fails, but keep host alive for other prototypes.
- [x] Create `webgpu/context.ts` (or `.js`) exporting `initContext(canvas)` that returns `{ adapter, device, queue, presentationFormat }` with async init guard.
- [x] Define `FrameUniforms` (frame index, dt, gravity vec3, time) as a `GPUBuffer` updated via `writeBuffer` each step; include typed array view for perf.
- [x] Build tiny command encoder helper: `withEncoder(device, (encoder) => { ...; queue.submit([encoder.finish()]); })` to keep passes clean.
- [x] Integrate xoroshiro128+ PRNG utility with seed setter, reseed button, and deterministic `rand()` helper shared by spawner + shader hash seeds.

## 2. Data & Spawning (Day 1–2)
- [x] Author shared types: `ArtifactClass`, `MaterialPreset`, `MeshBuffers`, `ConstraintBuffers`, plus enums for artifact states.
- [x] Draft JSON schema or inline configs describing class parameter ranges (size, thickness, crease positions, material preset id).
- [x] Build procedural mesh generators:
  - `buildBox(params)` returning vertex/normal arrays, crease edges, hinge rest angles.
  - `buildWrapper(params)` generating cloth-like grid with tagged bend edges.
  - `buildCoin(params)` small rigid mesh with normal map placeholder.
- [x] Assemble CPU staging buffers (ArrayBuffers) mirroring GPU layouts to allow `queue.writeBuffer` in one shot per artifact.
- [x] Implement seeded spawner loop: sample class, build mesh, push onto active list until max count; maintain ring buffer for reuse when artifacts settle.
- [x] Add lifecycle tracker storing timestamps, kinetic energy, and when to mark as `settling` → `baked` to stop sim cost.

## 3. GPU Simulation Core (Day 2–5)
- [x] Structure WGSL modules:
  - `integrate.wgsl`: semi-implicit Euler integration + damping + gravity.
  - `constraints_distance.wgsl`: XPBD distance solve with compliance, Jacobi accumulation.
  - `constraints_hinge.wgsl`: dihedral angle correction for crease edges.
  - `shape_matching.wgsl`: optional cluster solve for boxes/bottles (stubbed, bind groups/pipeline in place).
- [x] Share bind group layouts across passes so buffers remain bound (positions, velocities, constraint data, material params, uniforms).
- [x] Implement CPU fixed-step accumulator (1/120 s) running N iterations per frame; expose `iterationCount` and `globalDamping` via dev controls.
- [x] Add contact solver pass that collides vertices with a dynamic heightfield + bounding planes, outputs contact normal, impulse magnitude, and artifact/material ids into a `contactBuffer` SSBO capped per frame, plus an aggregate artifact/material staging buffer for strata.
- [x] Include rest detection kernel: compute kinetic energy per artifact, set `settledMask` bool when below threshold for consecutive frames (tied to the new artifact-state buffer).
- [x] Instrument timings by writing GPU timestamp queries (if available) or CPU fallback to measure pass durations.

## 4. Strata & Pigment Accumulation (Day 5–7)
- [x] Initialize accumulation textures sized to canvas (thickness R16F, pigment RGBA16F, shear RG16F) with persistent `GPUTexture`s and view cache.
- [x] Write `stamp_contacts.wgsl` that iterates contact entries, projects positions into texture space, applies Gaussian kernels based on impulse + material smear coefficient, and accumulates pigment + thickness.
- [x] Add `age_strata.wgsl` pass run every few frames to desaturate/deepen colors based on stored depth/time, referencing OKLCH LUT held in a small texture/buffer.
- [x] Compose final render pipeline:
  - Pass 1: draw active deforming meshes using vertex shader reading current positions, simple BRDF + rim.
  - Pass 2: full-screen quad combining live meshes with strata textures (height-based color remap, dust overlay, grain noise).
- [x] Implement developer toggles to visualize individual strata channels, contact mask, or heightfield for debugging compaction behavior.

## 5. UI/Controls & Tooling (Day 7–8)
- [x] Extend the existing prototype picker controls to inject a simple collapsible panel (checkbox + sliders) limited to developer view.
- Controls include:
  - [x] Spawn cadence slider.
  - [x] Per-material weight sliders.
  - [x] Max active artifacts control.
  - [x] Iteration count/damping/camera/strata aging sliders consolidated with UX copy.
  - [x] Export (PNG/WebM) triggers and seed input/reset polish.
- [x] Overlay HUD shows: FPS, sim step ms, #active/#settled, GPU timestamp per pass (if available), VRAM estimates, contact events per frame; update via `overlayCtx` each frame.
- [x] Include hotkeys for pausing sim, toggling slow motion, forcing bake of top layers, and dumping contact buffer for inspection.

## 6. Export & Persistence (Day 8–9)
- [x] PNG export path: `device.queue.copyTextureToBuffer` → `ImageBitmap` → hidden canvas → `toBlob` download, ensuring gamma-correct sRGB conversion (`src/prototypes/stratified.js` → `requestPNGExport`).
- [x] JSON manifest writer stores seed, prototype version, shader module hashes, texture sizes, control values, elapsed frames; attach to PNG via sidecar file (`buildExportManifest`).
- [x] WebM prototype: accumulate `ImageBitmap` frames every N steps, enqueue into WebCodecs `VideoEncoder`, allow cancel/resume, and surface download when flush completes, falling back to `MediaRecorder` when needed.
- [x] Add lightweight autosave checkpoint (localStorage) for dev use: retains seed, controls, and toggles between sessions (`persistControlValue`).

## 7. Validation & Polish (Day 9–10)
- [ ] Scenario runs logged to `docs/validation-report.md`:
  1. [x] Single-box drop (S1) confirming hinge behavior + pigment smear alignment.
  2. [ ] Mixed-material rain (S2) for constraint stability.
  3. [ ] Long-haul (S3, 10k+ frames) verifying no memory leaks, strata textures stay bounded.
- [ ] Performance profiling at 4K + 120 Hz target: capture timings for each compute/render pass, experiment with workgroup sizes, and adjust vertex counts.
- [ ] QA checklist: determinism (same seed → same strata), pause/resume correctness, export integrity, overlay accuracy.
- [ ] Update `docs/readme` with backlog callouts (receipts tearing, alpha-to-mesh importer, WebGL fallback, networked manifest sync) once the scenario data is in place.

## Immediate Follow-Ups
1. ✅ Baseline browsers are Chrome 129+/Edge Canary with optional features `shader-f16`, `timestamp-query`, and `texture-compression-bc`; bootstrap now filters those flags automatically.
2. ✅ Seed panel exposes apply/copy/reset/randomize plus a “Load Manifest” workflow that feeds exported JSON back into the active prototype and host state.
3. ✅ Keep dev-only controls inside the existing collapsible panel for now, documented in `readme.md` under “Stratified prototype cheat sheet” so public builds hide the extra sliders by default.
