# Build Plan — 2D Deformable Stack Simulator

Numbered milestones mirror the phased spec. Tasks focus on concrete implementation steps (no manual test chores).

1. [x] **v0.0 – Static Render Test**
   - [x] Define the canvas/world transform (origin, axes, DPI) inside the host helpers.
   - [x] Parse SpawnParams into boundary polylines and lattice particles without physics.
   - [x] Render canonical silhouettes (outline + fill) on Canvas2D using the shared transform.
   - [x] Expose AABB + centroid overlays so downstream phases can reuse them.

2. [x] **v0.1 – Core XPBD Prototype**
   - [x] Implement the deterministic XPBD loop for a single mesh (triangular lattice, 50–100 particles) with dt = 1/120, 2 substeps, 6 iterations.
   - [x] Add stretch + area constraints with configurable compliance α and stable ordering.
   - [x] Introduce the project-wide RNG wrapper (xoshiro128-style) and remove direct `Math.random` usage from the prototype path.
   - [x] Surface debug rendering of particles, edges, and residual magnitudes for solver tuning.

3. [x] **v0.2 – Friction + Damping**
   - [x] Extend the contact solver with Coulomb friction (μs≈0.5, μk≈0.3) and tangential clamps `|J_t| ≤ μ J_n`.
   - [x] Add velocity damping (c≈8 s⁻¹) plus write-back damping (γ≈0.15) per material profile.
   - [x] Thread the damping parameters through the solver config UI/hooks.

4. [x] **v0.3 – Bend + CCD**
   - [x] Generate bend/hinge constraints per lattice strip with material-driven compliance.
   - [x] Implement boundary-vertex CCD for the first 0.25 s of life using swept-circle tests.
   - [x] Add diagnostic visualization for bend angles vs. yield to support tuning.

5. [x] **v0.4 – Multiple Meshes + Spatial Hashing**
   - [x] Build the spawn scheduler enforcing `N_max = 8` active meshes with defer/drop reason codes.
   - [x] Implement placement clearance (AABB + surface probe + quantized jitter) referenced to the global RNG.
   - [x] Add deterministic spatial hashing + island batching for inter-mesh contact solving with penetration guard `ε_pen`.

6. [x] **v0.5a – Rectangular Strata Grid**
   - [x] Allocate the flat logical grid aligned to world axes with configurable resolution near boundary spacing.
   - [x] Attach boundary vertices to grid columns, clamping per-frame Δmass and Δdownshift.
   - [x] Render strata directly from grid accumulations plus overlays for σᵥ and height.

7. [x] **v0.5b – Warped Rendering Layer**
   - [x] Generate warp coefficients once at init using the global RNG (seed + coefficient asset under version control).
   - [x] Apply `p_render = W(p_logical)` strictly inside the render pipeline for both grid cells and mesh vertices.
   - [x] Provide warp-field visualization (vector field + displacement heatmap) to keep the asset inspectable.

8. [x] **v0.6 – Depth-Aware Compaction & Burial**
   - [x] Implement vertical overburden scans plus 2–4 Gauss-Seidel lateral creep sweeps per simulation tier.
   - [x] Apply `α_area_eff(σᵥ, εᵖ)` softening with exposed `kσ`, `kε`, and `σ_ref` parameters.
   - [x] Detect burial via interpolated surfaces and manage tier transitions (active → resting → buried) with timestamps and outline fades.

9. [x] **v0.7 – Plasticity Integration**
   - [x] Add unified plastic drift for stretch, area, and bend rest values gated by `max(σᵥ/σ_yield, strain/ε_yield, bendAngle/θ_yield)`.
   - [x] Store per-constraint plastic state for scheduling/throttling decisions.
   - [x] Surface `β_plastic` controls (≈0.02–0.05 s⁻¹) on material profiles, including buried-tier throttling hooks.

10. [x] **v0.8 – Determinism & Replay Validation**
    - [x] Hash SoA buffers (`x`, `y`, `σᵥ`, `εᵖ`) plus scheduler metadata every N frames and persist goldens per platform.
    - [x] Capture constraint residual RMS per type (stretch/area/bend/contacts) and expose thresholds in config.
    - [x] Provide a CLI replay diff that loads spawn schedules and reports mismatching frames.

11. [x] **v0.9 – Performance Profiling & Budget Enforcement**
    - [x] Instrument solver, grid, and rendering subsystems to emit per-frame timings vs. the 4/2/3 ms budgets.
    - [x] Implement adaptive iteration counts, plasticity throttling, and `N_max` caps tied to budget enforcement.
    - [x] Build canned profiling scenes (1, 4, 8 meshes) that exercise the instrumentation hooks.

12. [x] **v1.0 – Distance Joints & Islanding**
    - [x] Add distance joints for compound objects with deterministic per-island batching and adjacency recompute each frame.
    - [x] Extend plasticity/breakage logic to joints and ensure removal ordering stays deterministic.
    - [x] Update scheduler tiers so jointed artifacts maintain correct active/resting/buried behavior.

13. [x] **v1.1 – Production Integration**
    - [x] Finalize deterministic palette mapping (material `baseHue`, stress/plasticity/age → chroma/value, RNG-driven jitter).
    - [x] Implement memory budgets + GC for deep meshes while preserving outline data for rendering.
    - [x] Integrate TinyBrush/Vessel UI hooks for spawn control, playback, and profiling overlays.
    - [x] Consolidate documentation (Agents digest references, warp spec, RNG guarantees, visual mapping) into the release package.
    - [x] Prepare release soak harness that exercises color drift, compaction, and scheduler tiers on target hardware.

Use this checklist as the living build tracker; check items off as milestones land.
