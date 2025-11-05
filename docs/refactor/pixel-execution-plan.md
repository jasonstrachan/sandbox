# Pixel Art Refactor — Execution Plan

This plan expands on `docs/pixel-refactor.md`, translating the proposal into actionable work packets, owners, dependencies, and validation steps. Dates assume kickoff on **November 5, 2025**; adjust if the schedule shifts.

## Phase Overview

| Phase | Window | Goals | Primary Outputs |
| --- | --- | --- | --- |
| P1 – Pixel Foundations | Nov 5 – Nov 12 | Establish low-res render path, palette plumbing, UI hooks | Pixel buffer render target, palette registry, dev controls, smoke-test PNG export |
| P2 – Sediment Flow | Nov 13 – Nov 20 | Continuous spawning/compaction loop, dithering, camera scroll | Streaming spawner, strata persistence, Sierra Lite pass, HUD updates |
| P3 – Catalog & Polish | Nov 21 – Dec 1 | New artifact classes, decals, color aging, QA & export parity | Bottle/blister/tag meshes, atlas sampling, deterministic exports, validation logs |

## Detailed Tasks

### P1 – Pixel Foundations (Nov 5 – Nov 12)
- [x] **Render Target Split** *(Rendering)* — low-res pixel texture, upscale pass, persisted controls, PNG captures post-upscale.
- [x] **Palette System** *(Color Systems / Rendering)* — palette manifests + shader uniforms with deterministic selection + manifests.
- [x] **UI & Seed Integration** *(Core)* — “Pixel” control group, overlay readout, manifest snapshot coverage.
- [x] **Regression Pass** — `npm run build` successful; WebGPU path untouched for non-pixel fallback.

### P2 – Sediment Flow (Nov 13 – Nov 20)
- [x] **Streaming Spawner** *(Simulation / Gameplay)* — ring buffer spawning, compaction tracking without strata resets.
- [x] **Persistent Strata + Aging** *(Rendering)* — accumulation never clears, palette aging vs depth.
- [x] **Camera Scroll + Downward Conveyer** *(Gameplay)* — long-duration downward motion tied to sediment rate.
- [x] **Dithering & Post** *(Rendering)* — Sierra Lite compute pass, deterministic noise, exposed controls.
- [x] **HUD & Telemetry** *(Core)* — overlay enhancements for sediment depth, pixel grid, dither state.
- [ ] **Intermediate Validation** — captures + manifest logs in `docs/validation-report.md`.

### P3 – Catalog & Polish (Nov 21 – Dec 1)
- [ ] **Artifact Expansion** *(Geometry / Simulation)* — bottle/blister/tag meshes, weights, material presets.
- [ ] **Decal Atlas & Texture Hooks** *(Rendering)* — low-res atlas sampling + palette tinting.
- [ ] **Color Aging & Sediment Pressure** *(Simulation / Rendering)* — depth-driven palette/desaturation controls.
- [ ] **Export Parity & Manifests** *(Core)* — post-dither exports + manifest metadata.
- [ ] **QA & Validation Scenarios** *(QA)* — rerun S1–S3 + P1 + new Pixel Fidelity coverage.

## Dependencies & Risks
- **WebGPU Availability**: pixel buffer + compute passes require WebGPU; ensure graceful fallback text for unsupported browsers.
- **Determinism**: dithering must be deterministic; rely on seeded noise rather than time-based randomness.
- **Performance**: low-res buffer should reduce fill cost, but Sierra Lite compute pass could be expensive; profile and gate via control.
- **Asset Workflow**: Decal atlas must remain lightweight (<= 32×32 texels) to preserve pixel sharpness.

## Verification Checklist
- [x] Automated lint/build still passes (`npm run build`, `npm run lint:wgsl`).
- [ ] Scenario metrics captured after each phase.
- [ ] Manifest schema updated + documented.
- [ ] README + docs updated with new controls and hardware guidance.

## Communication Cadence
- **Weekly sync** (Fridays) to review phase progress + blockers.
- **Design reviews** at end of P1 (pixel look) and mid-P3 (palette + decals) with creative stakeholders.

## Success Criteria
- Visual output matches spec: jagged silhouettes, palette-driven strata, visible sediment motion over hours.
- System can run unattended for 12h with stable memory + VRAM footprint.
- Exports are deterministic and capture pixel-art presentation with manifest metadata for collectors.
