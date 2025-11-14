# 2D Deformable-Stack Simulator — Phased Specification (Organic Strata Field)

## Vision

A **living digital painting** visualizing the deceleration of consumption. Objects — symbols of desire and decay — fall slowly from above, bend and crumple on impact, and gradually compact into visible layers. Over time, these strata form a **geological record of consumption**, shifting from recognizable shapes to pixelated sediment.

---

## North Star Goals

1. **Living Digital Painting (2D):** Continuously evolving canvas; strata read like geology.
2. **Concurrent Mesh Deformation:** Many meshes fall and deform in parallel, each with distinct material response.
3. **Persisting Identity:** Each mesh’s outline remains traceable from spawn to burial.
4. **Depth-Aware Compaction:** Deeper layers compact, shear, and desaturate more than fresh ones.
5. **Stack-Wide Influence:** New weight propagates through the stack; buried artifacts remain responsive.
6. **Organic Determinism:** XPBD with fixed dt, seeded RNG, stable ordering, and quantized writes.

---

## Environmental Pieces (Stack Substrate)

### Canvas & Coordinate Frame

- v0.0 fixes the world origin at the top-left of the canvas with `+X` right / `+Y` down so render, physics, and overlay math stay aligned.
- World units map 1:1 to canvas pixels; DPI-aware helpers in the runtime keep logical resolutions stable across devices.

### Strata Grid Lifecycle

- v0.5a introduces a **rectangular logical grid** aligned with the world frame; all overburden calculations run vertically in that flat space.
- Boundary vertices attach directly to this grid, pulling along world-Y so new mass compacts older layers without needing warp-aware physics.
- v0.6 layers in vertical pressure gradients plus 2–4 lateral creep sweeps, using the `α_area_eff(σᵥ, εᵖ)` softening function to modulate compliance by stress and accumulated plastic strain.

### Warp Field `W(x, y)`

- v0.5b generates a single, deterministic C¹ displacement field at startup (seeded RNG with documented coefficients).
- Physics, contacts, and mass accumulation remain in flat logical space; rendering samples `p_render = W(p_logical)` to achieve organic strata without destabilizing the solver.
- No inverse warp is required in v0.x, and warp regeneration is deferred until a full scene reset.

### Compaction, Burial, and Palette Drift

- Burial detection uses interpolated flat-grid surfaces; outlines fade by age/depth but are never discarded, keeping the “geological record” legible.
- Depth-aware chroma/value mapping ties into the visual acceptance test where the bottom third of the field must desaturate relative to the top third.
- Long-lived meshes shift tiers (active → resting → buried → dormant) so overburden remains responsive even when agents update at reduced cadence.

### Deterministic RNG Backbone

- All stochastic inputs (spawn jitter, warp displacements, palette noise) draw from a single xoshiro128-style integer RNG implemented in WASM.
- No calls to `Math.random` are allowed inside the sim, ensuring deterministic replay across machines.

---

## Spawned Silhouettes & Budgets

We restrict v0.x to a small set of canonical silhouettes with fixed vertex and particle budgets. All spawning uses these shapes.

> For a condensed view focused on per-agent behavior, see `docs/Agents.md`.

### Canonical Silhouettes (v0.x)

1. **Box / Carton**

   * Description: rectangular shipping box, slightly chamfered corners.
   * Outline: 8–10 vertices (rectangle + chamfers).
   * Target lattice: 8×8 or 10×10 grid (64–100 particles).

2. **Flat Tag / Mailer**

   * Description: thin card, rounded corners, optional notch.
   * Outline: 8–12 vertices.
   * Target lattice: 6×8 grid (~48 particles).

3. **Bottle (PET or glass)**

   * Description: simplified bottle in profile (neck + shoulder + body).
   * Outline: 12–16 vertices.
   * Target lattice: 10×12 grid (~120 particles) in v0.x; may be reduced to 8×10 (~80) on lower-end profiles.

4. **Phone / Slab Device**

   * Description: rounded rectangle with inner “screen” detail for shading only.
   * Outline: 8–10 vertices.
   * Target lattice: 8×10 grid (80 particles).

5. **Irregular Fragment / Shard**

   * Description: broken piece of packaging, non-convex but simple.
   * Outline: 6–10 vertices (single concavity allowed).
   * Target lattice: 6×6 or 6×8 grid (36–48 particles).

6. **Handbag / Tote**

   * Description: soft rectangular or trapezoidal body with curved strap/handles.
   * Outline: 14–20 vertices (body + handle arcs).
   * Target lattice: 10×12 grid (~120 particles) with softer bend and higher plasticity to encourage creasing.

7. **Bicycle (Silhouette Chunk)**

   * Description: simplified side-on silhouette (frame triangle, wheels as flattened ellipses, no tiny spokes).
   * Outline: 18–26 vertices (frame + two wheel arcs + seat/handle hints).
   * Target lattice: 12×14 grid (~168 particles) used sparingly (e.g., at most 1–2 active at a time) due to higher cost; stiffer stretch but moderate bend plasticity.

8. **Bicycle Frame**

   * Description: rigid-forward bike frame outline with implied wheels; emphasises triangles and tubes more than sheets.
   * Outline: 12–16 vertices (triangle + seat/chain stays + bar hints).
   * Target lattice: 14×12 grid (~168 particles) paired with lower compliance / damping so it behaves near-rigid while airborne.

9. **Skull (Iconic Object)**

   * Description: stylised skull front-view (cranium + jaw contour), treated as a single slab for physics in v0.x; eyes/nose rendered as visual cutouts only.
   * Outline: 16–24 vertices (outer contour, no physical holes in v0.x).
   * Target lattice: 10×12 or 12×12 grid (~120–144 particles), slightly stiffer stretch to keep the recognisable outline, with bend and plasticity tuned so it can crack and flatten over time.

> **v0.x constraint:** Physics uses a **single outer contour** per mesh (no holes). Internal details (eye sockets, wheel interiors) are visual only.

### Shape Source & Determinism

/ Shard**

* Description: broken piece of packaging, non-convex but simple.
* Outline: 6–10 vertices (single concavity allowed).
* Target lattice: 6×6 or 6×8 grid (36–48 particles).

8. **Handbag / Tote**

   * Description: soft rectangular or trapezoidal body with curved strap/handles.
   * Outline: 14–20 vertices (body + handle arcs).
   * Target lattice: 10×12 grid (~120 particles) with softer bend and higher plasticity to encourage creasing.

9. **Bicycle (Silhouette Chunk)**

   * Description: simplified side-on silhouette (frame triangle, wheels as flattened ellipses, no tiny spokes).
   * Outline: 18–26 vertices (frame + two wheel arcs + seat/handle hints).
   * Target lattice: 12×14 grid (~168 particles) used sparingly (e.g., at most 1–2 active at a time) due to higher cost; stiffer stretch but moderate bend plasticity.

10. **Bicycle Frame**

   * Description: rigidised frame contour with triangles + bars; wheels implied only by the outline arc.
   * Outline: 12–16 vertices.
   * Target lattice: 14×12 grid (~168 particles) with lower compliance for stretch/area so it stays stiff in flight.

### Shape Source & Determinism

* All silhouettes are defined as **pre-authored polylines** (JSON assets) under version control.
* SpawnParams reference a `shapeId` from this canonical set; procedural variation (e.g., slight scale/rotation jitter) uses the global RNG.
* No arbitrary user-defined shapes participate in v0.x physics; they can be added in v1.x with explicit budgets.

### Budgets

* v0.x particle target per mesh: **36–120 particles**, depending on shape.
* v0.x constraint target per mesh: ~6× particle count (stretch + area + optional bend).
* Combined with `N_max = 8`, this bounds total particles at ~300–960 and constraints at ~1.8k–5.8k.

### Solver Strategy for Mixed Materials

We deliberately run everything through the **same XPBD solver** (`src/sim/core/solver.js`) so per-frame work stays predictable, but we layer in *modes* so rigid props don’t melt like cloth:

- **Single core integrator.** All artifacts share the same stretch / area / bend constraint pipeline and fixed `dt = 1/120 s`. Materials only differ by density, compliance, damping, etc., which keeps scheduling and determinism simple.
- **World-scale + energy restore.** `StackSimulation` now maintains `worldScale` (default `0.25`) so gravity is applied in “meters” and active tiers can opt into `restoreEnergy` to recover the kinetic energy XPBD bleeds off each iteration. This gives fast, ballistic drops without changing render space.
- **Tier-aware behavior (planned).** Rather than introducing multiple solvers, rigid-ish artifacts will run in an “active mode” that prunes soft constraints (area/bend) and/or adds lightweight shape-matching until first contact, then re-enables the full cloth-like solve for piling and compaction. Soft props simply stay in the full mode all the time.

This approach means we can simulate cardboard, totes, phones, or a simplified bicycle silhouette without spawning different physics engines. Performance stays bounded (same SoA layout, same constraint counts), and we only pay for extra rigidity where needed via per-artifact flags rather than whole new solvers.

---

## Capability Guarantees & Acceptance Criteria

### 1) Persistent, Deformable Mesh (all the way down)

**Guarantee:** Artifacts remain XPBD meshes for their entire lifecycle (spawn → burial). No raster stamping; buried meshes continue to receive simulation and field coupling.

* **Representation:** each artifact stores a fixed **boundary vertex set** derived from its spawn polyline (indices into the particle slice). This set is never GC’d and is always available for rendering, regardless of depth.
* **Scheduling:** buried meshes run at reduced rate but are updated at least **once every 4 frames** (configurable), so overburden changes can still deform them.
* **Coupling:** warp-aware attachments to the strata field continue to apply downshift/shear in buried state; plasticity remains active under yield criteria.

**Acceptance tests:**

* After 10 new drops above, an already-buried artifact’s average boundary-vertex displacement in the layer-normal direction is ≥ ε_settle.
* Outline remains renderable at depth with age/depth fade; no artifact ever loses its outline data.

### 2) Streaming Spawn of Items

**Guarantee:** Deterministic, back-pressured spawning at fixed simulation frames; safe placement under load.

* **Events:** `SpawnEvent{frame, seed, params}` queued by the front-end; released exactly at `frame` in the fixed-dt loop.
* **Placement:** AABB + surface query in warp space; seeded, quantized horizontal jitter (from global RNG) resolves tie-breaks.
* **Back-pressure:** maximum inflight artifacts `N_max` (initial target: **8 active meshes of 50–100 particles** at 60fps). Additional events are deferred or dropped with reason codes.

**Acceptance tests:**

* Given a fixed global seed and spawn schedule, multiple runs produce identical spawn poses and order.
* Under `N_max` overflow, no frame exceeds the target budget and no initial overlaps are created.

### 3) Proper Mesh↔Mesh Collisions

**Guarantee:** Stable, deterministic contact between different meshes with friction; no interpenetration.

* **Detection:** spatial hashing over particles; boundary-vertex circle proxies; optional edge–edge SDF where needed.
* **Stability:** CCD window on boundary vertices (first 0.25 s of life); Coulomb friction with tangential clamp and stick/slip threshold; restitution ≈ 0.
* **Solving:** constraints batched by island; fixed ordering by artifact and constraint id.

**Acceptance tests:**

* Symmetry test: dropping A then B vs. B then A (with corresponding seeds) produces consistent, non-explosive results.
* Penetration depth across regression scenes remains < ε_pen for all contacts.

### 4) Per-Mesh Material Properties

**Guarantee:** Each artifact defines independent physical properties (stiffness, mass, friction, plasticity, damping, coupling scale).

```ts
type MaterialProfile = {
  density: number;                           // mass per area
  compliance: { stretch: number; area: number; bend?: number };
  friction: { static: number; kinetic: number; restitution: number };
  plastic: { beta: number; yieldStrain: number; yieldBendDeg: number };
  damping: { velocity: number; writeback: number };
  gridCouplingScale: number;                 // attachment scaling
  baseHue: number;                           // visual mapping: 0–1
};
```

* Compliance maps to XPBD α; density controls particle masses (optionally heavier boundary weights); friction and damping are applied per-artifact.

**Acceptance tests:**

* Two otherwise identical meshes with different `density` settle to measurably different depths under identical loading.
* Increasing `compliance.stretch` (softer) increases maximum strain under identical impact by ≥ X%; decreasing it reduces strain by ≥ X%.

## Phased Delivery Plan

### **v0.0 – Static Render Test**

Goal: verify coordinate system, drawing, and outline representation before any physics.

* Define world/canvas mapping: origin at top-left, +X right, +Y down; world units = canvas pixels.
* Render a pre-defined wireframe mesh (from a SpawnParams polyline) at a fixed pose.
* Validate boundary-vertex extraction, AABB computation, and transform math.

**Success Criterion:** mesh outline and fill render correctly and match expected coordinates on all target devices.

### **v0.1 – Core XPBD Prototype**

Goal: deterministic crumple of a single soft body on a static ground.

* 50–100 particles (triangular lattice)
* Constraints: **Stretch + Area** only
* No friction, no plasticity
* Fixed dt = 1/120, 2 substeps, 6 iterations
* Canvas2D wireframe render
* Deterministic replay (spawn params only)

**Success Criterion:** identical outcomes across runs and systems.

---

### **v0.2 – Friction + Damping**

Goal: stable rest without oscillation.

* Add friction (μs≈0.5, μk≈0.3)
* Write-back damping γ≈0.15, velocity damping c≈8 s⁻¹
* Ground contacts only, restitution ≈ 0

---

### **v0.3 – Bend + CCD**

Goal: stable folds, no tunneling.

* Add bend/hinge constraint (no plasticity yet)
* Simple CCD for boundary vertices (0.25 s window)
* Verify determinism under collisions

---

### **v0.4 – Multiple Meshes + Spatial Hashing**

Goal: multi-artifact stability and throughput.

* Support up to **N_max = 8** active meshes (50–100 particles each) at 60fps as initial performance target.
* Spawn queue with clearance checks in warp space (AABB + surface probe).
* Spatial hashing keyed by particle id; deterministic iteration order.
* Prevent interpenetration (penetration < ε_pen); maintain fixed constraint ordering.

**Success Criterion:** test scene with 8 concurrent falling meshes runs under budget with no interpenetration or divergence.

---

### **v0.5a – Rectangular Strata Grid (Flat-Space Physics)**

Goal: introduce a compaction layer with simple, robust physics.

* Use a rectangular logical grid aligned with world axes (no warp in physics).
* Compute overburden via vertical column scans (−Y direction in world/logical space).
* Attach boundary vertices directly in logical coordinates; attachments pull along world-Y.
* Render strata directly from the logical grid (no warp yet).

### **v0.5b – Warped Rendering Only**

Goal: organic strata appearance without changing core physics.

* Generate a warp field `W(x,y)` **once at initialization** (seeded RNG):

  * Start from a rectangular grid; apply a low-frequency, C¹-continuous displacement field.
  * Use a documented blue-noise sampling + interpolation scheme; coefficients stored and quantized.
* Physics stays in flat logical space; overburden and compaction still computed vertically.
* Rendering: for each logical cell or mesh vertex, compute `p_render = W(p_logical)` for drawing only.
* No inverse warp is required; attachments and mass accumulation all use logical coordinates.

**Deferral:** any full warp-space physics (compaction along curved normals in warped coordinates) is a **v1.x stretch goal**, not part of v0.x.

---

### **v0.6 – Depth-Aware Compaction & Burial**

Goal: vertical pressure gradients and burial state.

* Lateral creep (2–4 Gauss-Seidel sweeps) in the flat logical grid.
* Area compliance softening vs. σᵥ and εᵖ via effective compliance:

  ```ts
  α_area_eff(σᵥ, εᵖ) = α_base * (1 + kσ * σᵥ/σ_ref) * (1 + kε * εᵖ);
  ```
* Burial detection via interpolated flat-grid surface query; outlines fade by age/depth.

---

### **v0.7 – Plasticity Integration**

Goal: permanent deformation and anti-inflatable material behavior.

* Unified **β_plastic** controlling drift of rest L₀, A₀, θ₀ under yield.
* Yield activation uses a combined metric:

  ```ts
  const yieldMetric = Math.max(
    σᵥ / σ_yield,
    strain / ε_yield,
    bendAngle / θ_yield
  );
  if (yieldMetric > 1.0) activatePlasticity();
  ```
* Rest values drift slowly (`β_plastic ≈ 0.02–0.05 s⁻¹`) only when `yieldMetric > 1.0`.

---

### **v0.8 – Determinism & Replay Validation**

Goal: verify deterministic behavior.

* Golden-frame checksums on particle + field arrays (x, y, σᵥ, εᵖ).
* Constraint residual RMS tests per type (stretch, area, bend).
* Automated replay diff harness.

---

### **v0.9 – Performance Profiling & Budget Enforcement**

Goal: ensure the system runs within target frame budgets.

* Instrument solver, grid, and rendering to record per-frame timings.
* Enforce solver, grid, and render time budgets (4/2/3 ms) via:

  * N_max caps,
  * tier-specific iteration counts,
  * optional throttling of plasticity and creep.
* Establish profiling scenes: 1 mesh, 4 meshes, 8 meshes.

---

### **v1.0 – Distance Joints & Islanding**

Goal: compound object mechanics.

* Distance joints only; pre-batched per island.
* Joint adjacency recomputed once per frame.
* Plasticity & breakage; deterministic ordering.

---

### **v1.1 – Production Integration**

Goal: cohesive, performant system with clear visual language.

* Full strata field compaction + chroma/age visualization.
* Memory budgets & GC for deep meshes.
* UI integration (TinyBrush / Vessel mode).
* Documentation and tuning pass.

#### Visual Mapping & Palette Drift

Define a deterministic mapping from physical state to color:

```ts
// Material-driven base hue
hue = mat.baseHue;

// Chroma and value from stress, plasticity, and age
chroma = f_chroma(σᵥ, εᵖ, age);
value  = f_value(σᵥ, εᵖ, age);

// Optional timing jitter (deterministic noise)
timingJitter = noise(globalSeed, frame, cellId);
```

* Deeper, more compacted layers have lower chroma / more muted values.
* Function shapes are fixed and documented; all noise comes from the global RNG (no `Math.random`).

**Visual Acceptance Test:** in a controlled drop sequence, the average chroma of strata in the bottom third of the field is ≤ X% of the top third at steady state.

---

#### Solver Diagnostics Overlay (XPBD Residuals)

* `stretchResiduals` visualizes the unsatisfied XPBD stretch stress per edge. We normalize by `restLength`, clamp to `[0,1]`, then map to color: **0.0 → cyan/teal**, **1.0 → magenta/pink**. Bright pink edges are the highest-tension constraints that the solver still needs to resolve.
* `bendResiduals` reuse a green→red hue ramp to show angular error, but the stretch overlay is the canonical way to spot stress hot spots at a glance.
* Diagnostic toggles in the UI simply flip these overlays on; they never affect the solver.

---

## Engineering Details (Integrated)

### Future Extension: True Holes in Physics (v1.x)

* v1.x may introduce meshes with **outer + inner loops** (polygons with holes) for shapes like bicycle wheels and skull eye sockets.
* Requirements for that phase:

  * Robust triangulation supporting polygons with holes.
  * Constraint generation spanning both outer and inner boundaries.
  * Collision handling aware of inner edges.
* This is explicitly **out of scope for v0.x**, which uses single-contour silhouettes for stability and determinism.

---

## Engineering Details (Integrated)

### Randomness Model

* All random-like behavior (spawn jitter, warp field generation, layer normals, palette drift) derives from a **single integer RNG** with a documented seeding scheme.
* RNG choice: e.g. **xoshiro128**-style generator (128-bit state, 32-bit outputs) implemented in WASM with explicit bit-width guarantees.
* No use of `Math.random` or environment RNGs inside the sim; all randomness is explicit and reproducible.

### 1. Grid Resolution & Coupling Stability

* Grid spacing **h** ≈ average boundary-vertex spacing.
* Scale attachment compliance `(h / h_ref)` to avoid over-stiff coupling.
* Clamp per-frame column mass Δ and downshift Δ to suppress oscillation.

### 2. Contact Stability

* Tangential impulse clamp `|J_t| ≤ μJ_n`.
* Stick/slip velocity threshold 2–5 px/s.

### 3. Warp-Aware Rendering & Mass Accumulation

* Physics and mass accumulation run in flat logical space.
* For v0.5b, rendering samples positions through `W(x,y)`; mass accumulation remains on the rectangular grid.
* Quantize Float32 writes before overburden scan.

### 4. Determinism & Replay

* Stable hash iteration; fixed constraint ordering.
* Quantize field writes and constraint corrections.
* Hash (x, y, σᵥ, εᵖ) every N frames for replay diff.

### 5. WASM Integration

* SoA layout; contiguous slices per artifact.
* Single substep entry; no JS callbacks in the solver loop.
* Quantize Float32 outputs before Canvas2D upload.

### 6. Simulation Tiers & Scheduling

We explicitly tier simulation cost by artifact state:

1. **Active** (falling / colliding)

   * Full substeps and iterations (e.g. 2–3 substeps, 6–10 iters; area constraints may use more effective iterations if residuals are high, targeting 10–15 where needed).
   * Full constraint set: stretch + area + bend + contacts.
   * Counted against the **N_max active mesh budget**.

2. **Resting** (recently settled on the surface)

   * Same dt, but may reduce iterations (e.g. 6 → 4).
   * Optionally drop or thin expensive constraints (subset of bend).
   * Still updated every frame; priority just below active meshes.

3. **Buried**

   * Reduced update rate: at least once every **4 frames**, or sooner if local σᵥ changes beyond a threshold.
   * Fewer iterations (e.g. 3–4); often stretch + area + attachments only.
   * Primary role: respond to overburden via the strata field, not high-frequency contact.

4. **Dormant** (very deep, long-term stillness; optional)

   * No regular solver updates; only reactivated when local σᵥ or nearby activity changes beyond a threshold.
   * Keeps outline and a small landmark set for rendering; full pose can be recomputed or left frozen depending on visual needs.

The scheduler enforces that:

* The number of **Active** meshes never exceeds `N_max`.
* Buried and Dormant tiers amortize cost over many frames while preserving stack-wide influence.
* Constraint and iteration counts are adapted per tier to respect the per-frame solver budget.

---
