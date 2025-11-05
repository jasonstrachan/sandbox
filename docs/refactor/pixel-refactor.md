# Pixel Art Refactor — Proposal

## Intent
- Reframe **Stratified Time** as a **2D pixel-native experience** while preserving the existing deterministic physics + strata accumulation core.
- Translate the conceptual brief (“geological record of consumption”, *Meridian*-inspired mark layering) into three concrete pillars:
  1. **Low-res materiality** – chunky silhouettes, jagged edges, palette-driven depth.
  2. **Procedural sediment** – continuous rain of deformable artifacts that compact into persistent strata.
  3. **Long-duration legibility** – slow downward drift, per-layer color logic, export parity with PNG/WebM.

## Constraints & Targets
- **Display**: live installation @ 1920×1080+ while simulation renders to a configurable pixel grid (e.g. 384×216, 512×288) and upscales with pixel-perfect rules.
- **Frame budget**: keep WebGPU compute passes ~4 ms @ 120 Hz on M3 Max / RTX 4090 after the added post-processing.
- **Determinism**: same seed → identical low-res buffer, dithering, color quantization.
- **Tooling**: remain inside Vite + vanilla JS/WebGPU; avoid introducing heavyweight shader frameworks.

## Reality Check — 4 Nov 2025
- Field tests still show a single faceted artifact looping with no visible wave-based influx. The “streaming spawner” milestone in §5 was prematurely marked complete.
- The current `spawnCadence` path simply toggles `state.needsRespawn`, which calls `respawnArtifacts` and wipes+repopulates the entire simulation (optionally preserving strata). There is no incremental insertion step, so strata, compaction, and scroll never receive a continuous feed.
- Camera scroll + compaction now amplify the absence of new debris, producing long stretches of empty sediment. We must finish Workstream 5 before layering additional polish.

## Workstreams

### 1. Pixel Pipeline & Presentation
- [x] Add a **pixel buffer render target** (texture + `copyTextureToTexture`) sized via new controls: `pixelWidth`, `pixelHeight`, `pixelFilter`.
- [x] Introduce a **display shader** that upsamples using nearest-neighbor and runs a Sierra Lite-inspired error-diffusion post pass.
- [x] Replace current iso shading with **palette lookups**: store OKLCH→sRGB palette tables per state (`fresh`, `mid`, `sediment`).
- [x] Enforce **jagged silhouettes** by snapping projected vertices to pixel centers before rasterization.

### 2. Palette & Layer Logic
- [x] Define palette manifests in JSON (seeded per run) and expose control(s) for palette families.
- [ ] Extend strata accumulator so pigment/thickness outputs are quantized against palette bands before writing to the pixel buffer.
- [ ] Implement **depth-based palette drift**: deeper layers trend toward desaturated hues; topmost layers retain source palette vibrancy.

### 3. Dithering & Texture Treatment
- [x] Integrate **Sierra Lite** dithering kernel as a compute/post pass over the low-res buffer; use deterministic parameters so exports remain stable.
- [x] Add controls for dithering intensity + pattern scroll speed.
- [ ] Introduce **procedural decals** (barcode strips, stickers) sampled from a tiny atlas, tinted via palette groups to reinforce pixel-art motifs.

### 4. Object Catalog Expansion
- [ ] Implement additional mesh builders + material presets for **bottle/can**, **blister pack**, **tag/receipt** to match the spec.
- [ ] Tag salient edges as “weak hinges” so deformation concentrates there; expose hinge compliance multipliers per material.
- [ ] Author per-class color hooks (primary/secondary palette ids, decay bias) so objects imprint unique sediment signatures.

### 5. Continuous Sedimentation Flow
- [ ] Replace `respawnArtifacts` wholesale clears with a **streaming spawner** that inserts new artifact waves while keeping strata textures persistent. Required sub-work:
  1. Split spawning into `spawnWave({count, weights})` that writes into unused slots without touching active bodies.
  2. Maintain a circular pool (≤ `maxArtifacts`) so older settled artifacts are retired only when the pool is full.
  3. Reinterpret `spawnCadence` as seconds between waves plus optional burst count so we can art-direct density.
  4. Move strata/palette compaction updates to trigger per wave instead of per full respawn.
- [x] Add a pool-saturation guard + manual recycle control so exhausted pools no longer trigger continuous full respawns (buying time until the streaming rewrite lands).
- [x] Add a slow, deterministic **vertical camera scroll** so strata migrate downward over hours, revealing new layers at the top.
- [x] Track **compaction depth** and gradually increase palette desaturation as objects descend/bake.

### 6. Controls, HUD, Exports
- [x] Extend UI with a “Pixel” section: resolution sliders, palette picker, dithering toggle, layer color aging speed.
- [x] Update overlay to display pixel grid info, palette ID, and current sediment depth.
- [ ] Ensure PNG/WebM exports capture the **post-dithered pixel buffer** plus manifest entries for palette/dither settings.

## Proposed Phasing
- [x] **Week 1** – Pixel buffer, display shader, palette system stub, UI controls (hidden dev panel).
- [ ] **Week 2 (re-opened)** – Sierra Lite pass ✅; artifacts streaming ❌; non-destructive strata accumulation needs verification after the streaming rewrite; camera scroll ✅.
- [ ] **Week 3** – New object classes + decal atlas, palette aging integration, HUD/export polish, validation runs.

## Open Questions
- Should dithering live in compute (deterministic) or fragment (cheaper but order-dependent)?
- Do we support multiple pixel aspect ratios per edition, or lock to one master grid?
- How aggressively should we quantize the strata textures? (Full 8-bit channels vs mixed 16F for physics inputs.)

Feedback welcome before implementation begins.
