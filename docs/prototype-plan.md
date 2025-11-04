# Stratified Time — Prototype Implementation Plan

## 1. Project Skeleton (Day 0–1)
- Audit `src/core/host.js`, `loop.js`, and current prototype mounting to map out lifecycle hooks (init, update, destroy).
- Add WebGPU feature gate: prompt fallback text if adapter/device request fails, but keep host alive for other prototypes.
- Create `webgpu/context.ts` (or `.js`) exporting `initContext(canvas)` that returns `{ adapter, device, queue, presentationFormat }` with async init guard.
- Define `FrameUniforms` (frame index, dt, gravity vec3, time) as a `GPUBuffer` updated via `writeBuffer` each step; include typed array view for perf.
- Build tiny command encoder helper: `withEncoder(device, (encoder) => { ...; queue.submit([encoder.finish()]); })` to keep passes clean.
- Integrate xoroshiro128+ PRNG utility with seed setter, reseed button, and deterministic `rand()` helper shared by spawner + shader hash seeds.

## 2. Data & Spawning (Day 1–2)
- Author shared types: `ArtifactClass`, `MaterialPreset`, `MeshBuffers`, `ConstraintBuffers`, plus enums for artifact states.
- Draft JSON schema or inline configs describing class parameter ranges (size, thickness, crease positions, material preset id).
- Build procedural mesh generators:
  - `buildBox(params)` returning vertex/normal arrays, crease edges, hinge rest angles.
  - `buildWrapper(params)` generating cloth-like grid with tagged bend edges.
  - `buildCoin(params)` small rigid mesh with normal map placeholder.
- Assemble CPU staging buffers (ArrayBuffers) mirroring GPU layouts to allow `queue.writeBuffer` in one shot per artifact.
- Implement seeded spawner loop: sample class, build mesh, push onto active list until max count; maintain ring buffer for reuse when artifacts settle.
- Add lifecycle tracker storing timestamps, kinetic energy, and when to mark as `settling` → `baked` to stop sim cost.

## 3. GPU Simulation Core (Day 2–5)
- Structure WGSL modules:
  - `integrate.wgsl`: semi-implicit Euler integration + damping + gravity.
  - `constraints_distance.wgsl`: XPBD distance solve with compliance, Jacobi accumulation.
  - `constraints_hinge.wgsl`: dihedral angle correction for crease edges.
  - `shape_matching.wgsl`: optional cluster solve for boxes/bottles.
- Share bind group layouts across passes so buffers remain bound (positions, velocities, constraint data, material params, uniforms).
- Implement CPU fixed-step accumulator (1/120 s) running N iterations per frame; expose `iterationCount` and `globalDamping` via dev controls.
- Add contact solver pass that collides vertices with a dynamic heightfield + bounding planes, outputs contact normal, impulse magnitude, and artifact/material ids into a `contactBuffer` SSBO capped per frame.
- Include rest detection kernel: compute kinetic energy per artifact, set `settledMask` bool when below threshold for consecutive frames.
- Instrument timings by writing GPU timestamp queries (if available) or CPU fallback to measure pass durations.

## 4. Strata & Pigment Accumulation (Day 5–7)
- Initialize accumulation textures sized to canvas (thickness R16F, pigment RGBA16F, shear RG16F) with persistent `GPUTexture`s and view cache.
- Write `stamp_contacts.wgsl` that iterates contact entries, projects positions into texture space, applies Gaussian kernels based on impulse + material smear coefficient, and accumulates pigment + thickness.
- Add `age_strata.wgsl` pass run every few frames to desaturate/deepen colors based on stored depth/time, referencing OKLCH LUT held in a small texture/buffer.
- Compose final render pipeline:
  - Pass 1: draw active deforming meshes using vertex shader reading current positions, simple BRDF + rim.
  - Pass 2: full-screen quad combining live meshes with strata textures (height-based color remap, dust overlay, grain noise).
- Implement developer toggles to visualize individual strata channels, contact mask, or heightfield for debugging compaction behavior.

## 5. UI/Controls & Tooling (Day 7–8)
- Extend the existing prototype picker controls to inject a simple collapsible panel (checkbox + sliders) limited to developer view.
- Controls include: spawn cadence slider, max active artifacts, per-material weight sliders, iteration count, damping, camera pan speed, strata aging multiplier, export PNG/WebM buttons, seed input/reset.
- Overlay HUD shows: FPS, sim step ms, #active/#settled, GPU timestamp per pass (if available), VRAM estimates, contact events per frame; update via `overlayCtx` each frame.
- Include hotkeys for pausing sim, toggling slow motion, forcing bake of top layers, and dumping contact buffer for inspection.

## 6. Export & Persistence (Day 8–9)
- PNG export path: `device.queue.copyTextureToBuffer` → `ImageBitmap` → hidden canvas → `toBlob` download, ensuring gamma-correct sRGB conversion.
- JSON manifest writer stores seed, prototype version, shader module hashes, texture sizes, control values, elapsed frames; attach to PNG via sidecar file.
- WebM prototype: accumulate `ImageBitmap` frames every N steps, enqueue into WebCodecs `VideoEncoder`, allow cancel/resume, and surface download when flush completes (even if bitrate/quality unoptimized).
- Add lightweight autosave checkpoint (localStorage) for dev use: retains seed, controls, and toggles between sessions.

## 7. Validation & Polish (Day 9–10)
- Scenario runs:
  1. Single-box drop to confirm hinge behavior + pigment smear alignment.
  2. Mixed-material rain (boxes/wrappers/coins) for constraint stability.
  3. Long-haul (10k+ frames) verifying no memory leaks, strata textures stay bounded.
- Performance profiling at 4K + 120 Hz target: capture timings for each compute/render pass, experiment with workgroup sizes, and adjust vertex counts.
- QA checklist: determinism (same seed → same strata), pause/resume correctness, export integrity, overlay accuracy.
- Update `docs/readme` with run instructions, dev-only control summary, and backlog (receipts tearing, alpha-to-mesh importer, WebGL fallback, networked manifest sync).

## Immediate Follow-Ups
1. Confirm the WebGPU baseline (Chrome 129 nightly? Edge Canary?) plus required optional features (`shader-f16`, `timestamp-query`, `bgra8unorm-storage`) so context bootstrap knows what to request/fallback.
2. Finalize seed-control UX (text input + “dice” button + load-from-manifest) and how it integrates with existing prototype picker state persistence.
3. Decide whether dev-only controls should sit in the main overlay or a floating panel to avoid impacting eventual public presentation.
