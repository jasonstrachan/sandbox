# Project Spec: **Stratified Time**

## Concept Overview

An art drop that visualises the deceleration of consumption. Objects — symbols of desire and decay — fall slowly from above, bend and crumple on impact, and gradually compact into visible layers. Over time, these strata form a **geological record of consumption**, shifting from recognizable shapes to painterly sediment.

The work draws conceptual inspiration from *Meridian* by Matt DesLauriers — especially its mark-based layering, generative determinism, and digital materiality — but is built as a **digital-native** work designed for long-duration, live display and evolving animation rather than print fidelity.

---

## Visual Language

* **Artifacts:** Simplified silhouettes (boxes, bottles, tags, wrappers). Bend and crumple at joints; motion dampens into stillness.
* **Strata:** Compacted layers formed from thousands of micro-marks and fragments — creating a sedimentary, digital texture.
* **Texture:** Dust, cracks, faded ink, timestamp ghosts, pigment smears.
* **Influences:** *Meridian*’s generative layering, sumi-e verticality, and textile-like accumulation.
* **Tone:** Slow, melancholic, systemic — a meditation on accumulation and decay.

---

## Composition

### Hybrid Cross-Section View

* **Top zone:** Visible falling, deformation, and compression.
* **Lower zone:** Fully compacted strata with subtle color drift and shear.
* **Camera:** Slowly pans upward, turning new compression into static strata — merging motion and memory.
* **Mark Density:** Continuous accumulation of tiny visual events (collisions, smears, micro-particles) generating evolving texture and depth.

---

## Behaviour & Mechanics

1. Objects spawn from top (deterministic seed).
2. Fall under GPU physics (gravity, drift, flexion).
3. On impact: squash, smear pigment, integrate into strata.
4. Motion energy dissipates gradually.
5. Aging shader darkens and desaturates deeper layers.
6. Over time, forms dissolve into densely packed, color-shifting strata.

---

## Object System

### Object Classes (abstracted, logo-free)

* **Box/Carton** (paperboard): beveled cuboid that collapses along creases; tape/sticker ghosts.
* **Bottle/Can** (plastic/metal): capsule/cylinder with ring seams; dents & axial squash.
* **Blister/Clamshell** (thermoform plastic): shell + cavity; kinks, white stress lines.
* **Wrapper/Film** (plastic/paper foil): thin sheet that crinkles and folds like cloth.
* **Tag/Label/Receipt** (paper): rectangle with perforations; curls and tears.
* **Coin/Token** (metal/plastic): disk with shallow emboss; edge nicks.

Each class maps to a **Material** preset: `{ density, stiffness_bend, stiffness_stretch, damping, friction, smearCoeff }`.

### Look & Marking

* **Silhouette-first** abstraction; no brand marks.
* **Procedural patterns:** faint barcode segments, price-sticker circles, adhesive residue, UV fading bands.
* **Micro‑marks:** per‑impact specks, ink transfers, scrape streaks.
* **Palette:** OKLCH‑biased toward desaturation with depth.

### Representation

* **Primary:** **Procedural meshes** (triangles) with per‑vertex attributes for joints/creases.
* **Optional decals:** Small **bitmap atlas** for generic fragments (barcode strips, torn stickers). Kept low‑res; sampled in fragment shader; tinted by palette.
* **No full‑image bitmaps** for objects — keeps outputs deterministic, light, and style‑consistent.

### Authoring / Setup

* Define **archetypes** per class with param ranges (size, thickness, crease layout).
* Seed → choose class + params → build mesh + crease map → upload to GPU buffers.
* Material preset selects constraint strengths and smear response.

---

## Deformation & Joints

### Models by Object Type

* **Boxes/Cartons (quasi‑rigid with creases):**

  * Mesh segmented by **crease edges** (hinge joints).
  * **Articulated PBD**: maintain edge lengths; apply **hinge angle constraints** around creases; small plasticity to keep dents.
  * Optional **cluster shape‑matching** to preserve box volume while allowing dents (Müller et al.).
* **Bottles/Cans (shell soft‑body):**

  * Cylindrical/capsule lattice; radial **position constraints** + axial squash; ring seams as stiffer loops.
  * **Shape‑matching clusters** to keep overall silhouette; local dent masks.
* **Blister/Clamshell:**

  * Thin shell with higher bending stiffness; creases form at ridge lines under impact.
* **Wrappers/Film (cloth):**

  * Grid mesh with **stretch**, **shear**, and **bending** springs; edge friction with stack; high damping after impact.
* **Tags/Receipts (paper):**

  * Cloth‑lite with higher bending; **tear probability** along perforations (split triangles when strain > threshold).
* **Coins/Tokens (rigid):**

  * Rigid body with minor edge deformation; mostly translation/rotation + pigment transfer.

### Constraints & Joints Data

```ts
// CPU-side (TS)
interface ConstraintBuffers {
  // Generic PBD/XPBD style
  pos: Float32Array;      // xyz per vertex
  vel: Float32Array;      // xyz per vertex
  mass: Float32Array;     // 1/weight
  edges: Uint32Array;     // index pairs for distance constraints
  restLen: Float32Array;  // per-edge rest length
  hinges: Uint32Array;    // quadruplets (i,j,k,l) for dihedral/hinge
  restAngle: Float32Array;// hinge rest angles (creases)
  cluster: Uint32Array;   // cluster membership per vertex (shape-matching)
}
```

**Material → constraint params**

```ts
type MaterialPreset = {
  stretch: number; bend: number; shear: number; damping: number;
  friction: number; restitution: number; plasticity: number;
  smearCoeff: number; // how much pigment transfers on impact
};
```

### GPU Compute Pass (sketch)

* **Integrate:** `v += g*dt; p += v*dt` (with damping).
* **Project constraints (XPBD):**

  1. Distance (edges) → maintain lengths.
  2. Hinge/dihedral → fold along creases.
  3. Cluster shape‑matching → preserve volume/silhouette.
* **Collide with heightfield:** resolve penetration; write **impulse & contact mask**.
* **Apply friction & resting tests:** when KE < ε and contacts stable → mark **settled**.

```wgsl
// WGSL outline (pseudo)
@compute @workgroup_size(256)
fn project_distance(...) { /* solve edge constraints */ }
@compute fn project_hinge(...) { /* dihedral angle correction */ }
@compute fn shape_match(...) { /* cluster centroids + rotations */ }
```

### Pigment Smear / Sediment Blend

* On contact, write **contact UVs + impulse** to a transient buffer.
* Fragment pass samples this to stamp **directional smears** into a **strata accumulation texture** (RGBA + depth).
* Older strata gradually **yellow/desaturate** via time‑based LUT.

---

## Minimal Object Factory

```ts
function spawnArtifact(seed: string): Artifact {
  const cls = pickClass(seed);
  const mat = materialFor(cls);
  const params = sampleParams(cls, seed);
  const mesh = buildMesh(cls, params);      // vertices, indices
  const creases = buildCreases(cls, params); // edges + restAngles
  uploadToGPU(mesh, creases, mat);
  return { id: uid(), cls, mat, params };
}
```

---

* **Stack:** TypeScript + Vite
* **Render:** **WebGL/WebGPU-first**, designed for live digital installation, web display, and time-based editions.
* **Physics:** GPU compute solver for deformation, collision, and compaction.
* **Mark System:** Each drop emits hundreds of micro-strokes for sedimentary texture (inspired by *Meridian*’s layered markmaking).
* **State:** Zustand for deterministic state and reproducibility.
* **Random:** Seeded PRNG (xoroshiro128+).
* **Color:** OKLCH → sRGB conversion for perceptual fade.
* **Export:** PNG, WebM (WebCodecs), JSON manifest.

## CPU–GPU Responsibilities

**CPU (TypeScript):**

* Seeding & determinism (xoroshiro128+), parameter sampling, edition manifest.
* Procedural mesh build or **alpha→mesh** conversion; create buffers/metadata.
* WebGPU setup (pipelines/layouts), **dispatch scheduling** (compute + render passes).
* High‑level state (Zustand), UI, timeline control; checkpointing.
* **Export** orchestration (PNG / WebM via WebCodecs), saving manifests.

**GPU (WebGPU/WebGL):**

* **Physics:** integration, XPBD distance/hinge, optional cluster shape‑matching, contacts/friction, **ragdoll compliance scaling**.
* **Compaction:** strata heightfield update, shear, thickness accumulation.
* **Pigment & Aging:** contact‑driven smears into accumulation textures; time‑based fade/desaturation (LUT).
* **Rendering:** vertex transform, fragment shading/compositing, subtle post (grain/vignette).

**Data Flow**

```
Seed → (CPU) mesh/params → (GPU) upload buffers
    → [Compute] integrate + constraints + collisions
    → [Compute] compaction + contact buffer
    → [Render] strata accumulation + active objects
    → (CPU) readback for export (optional)
```

**Sync & Determinism**

* Fixed sim timestep; frame index & `dt` in a uniform block.
* Shader RNG via integer hash/xorshift; **no Math.random** in the loop.
* Ragdoll window controlled by uniform `impactPhase ∈ [0,1]`.
* CPU never mutates vertex positions; only updates uniforms/dispatch cadence.

**Perf Targets**

* ≤ 300 active objects; ≤ 1k verts per box.
* 2–3 constraint iterations/frame; strata updates in dirty regions.

## Units

* **Scene unit:** 1 cm.
* **Gravity:** 981 cm/s².
* **Box size:** 6–30 cm; thickness 0.2–0.5 cm.
* **Density (g/cm³):** paperboard 0.6–0.9; plastic 0.9–1.2; metal 2.5–7.8.

## Fixed-Step Simulation Loop

* `dt_sim = 1/120` s, global iterations: 2–3.
* Accumulator render:

```
acc += dt_frame
while (acc >= dt_sim) { step(dt_sim); acc -= dt_sim }
render()
```

## Constraint Conflict Strategy

* **Jacobi with delta buffers**: constraints write to `dPos` and weights; apply in a separate pass.
* Optional **graph coloring** batches later for edges/hinges.

## Strata Textures & Compaction Kernel

* **Thickness:** R16F (cm)
* **Pigment:** RGBA16F (linear)
* **Shear:** RG16F
* Imprint: impulse-weighted Gaussian with σ from material compressibility; directional smear along contact tangent; LUT aging.

## Collision Model Details

* Heightfield: 1–2 cm/px; bilinear height; normals via central differences + 3×3 smoothing.
* Coulomb friction with stick/slip; penetration correction.

## Determinism & Versioning

* RNG per kernel = hash(globalSeed, frame, objectId, passId).
* Manifest: shader hash, pipeline layout, texture sizes, `dt`, iterations.

## Memory Budgets & Baking

* ≤ 300 active objects; ≤ ~1k verts/object.
* Bake when settled + below top 20% viewport; free mesh buffers.
* VRAM @ 4K: pigment ~63 MiB, thickness ~16 MiB, shear ~32 MiB (≈111 MiB + transient).

## Browser Support / Fallback

* Requires WebGPU (Chrome/Edge; Safari TP partial). Gate `shader-f16`.
* No WebGL2 physics fallback initially; optional view-only fallback.

### GPU Pipeline Outline

1. **Vertex Buffer:** Artifacts as deformable meshes (triangles + joints).
2. **Compute Shader:** Gravity, velocity, joint bending.
3. **Fragment Shader:** Material color, pigment smear, and accumulation blending.
4. **Mark Accumulation Buffer:** Stores micro-stroke data for sediment texture.
5. **Frame Export:** Copy GPU texture for PNG/Video encoding.

---

## Animation & Frames

**Modes:**

* **Live:** Continuous WebGPU render loop (real-time deformation and compaction).
* **Edition:** Fixed timestep rendering; deterministic frame capture for unique seeds.
* **Time-Lapse:** Sample every N frames to compress long simulations.

**Controls:** ▶ Play / ⏸ Pause / 🕓 Timelapse / 🎞 Export

---

## Alpha‑to‑Mesh Conversion Pipeline

### Purpose

Enable importing arbitrary object silhouettes from alpha‑masked images to generate deformable low‑poly meshes suitable for the WebGPU simulation.

### Steps

1. **Input:** RGBA image (PNG/WebP) where transparency defines object shape.
2. **Preprocess:**

   * Extract alpha channel → binary mask (opaque=1, transparent=0).
   * Threshold at 0.5 for crisp edge.
3. **Contour Extraction:** Use **Marching Squares** or **Potrace** to trace polygon boundary.
4. **Simplification:** Reduce vertex count with **Douglas–Peucker** tolerance (~2–3 px).
5. **Triangulation:** Convert polygon → triangles (Earcut, poly2tri, etc.).
6. **(Optional)** Extrude slightly in Z for 2.5D thickness; tag sharp corners as hinge candidates.
7. **Export:**

   * `vertices: Float32Array [x,y,(z)]`
   * `indices: Uint32Array`
   * Optional crease metadata (`edgeFlags`)
   * Save as `.json` or `.glb`
8. **GPU Upload:** treat same as procedural object buffers; assign material + constraints.

### Example (TypeScript)

```ts
import { traceContour, simplify, triangulate } from 'poly-tools';

async function imageToMesh(src: string, threshold = 0.5) {
  const img = await loadImage(src);
  const alphaMask = extractAlpha(img, threshold);
  const contour = traceContour(alphaMask);
  const simplified = simplify(contour, 2.0);
  const { vertices, indices } = triangulate(simplified);
  return { vertices, indices };
}
```

### Notes

* Works best with clean silhouettes and 512–1024 px sources.
* Optional diffuse decal: reuse the original PNG as texture for colour information.
* Ideal for irregular wrappers, torn shapes, or bespoke silhouettes.
* Keeps deterministic reproducibility (contour generation is seed‑stable if image is constant).

---

## Artistic Parallels — Meridian

* Uses deterministic seeding like *Meridian’s* token hash to ensure each run’s uniqueness.
* Builds imagery from **micro-strokes and marks**, producing natural irregularity.
* Employs **stratified vertical composition**, evoking geological and textile structures.
* Prioritises **digital-native evolution** — generative motion, not print-scale resolution.
* Balances **algorithmic structure** and **analogue imperfection**, echoing slow, material decay.

These principles guide *Slow Consumption*: reproducible, tactile, and procedural — a digital artefact unfolding in time.

---

## Development Plan

**Sprint 1 — GPU Prototype:** WebGPU renderer + deformation compute pass + mark accumulation + PNG export.
**Sprint 2 — Texture & Depth:** Layer blending, aging shader, WebM export.
**Sprint 3 — Polish:** Rare events, material types, replay manifest, installation-ready configuration.

---

## Next Step

Implement the WebGPU prototype using seeded micro-strokes and joint deformation — bridging physical impact simulation with evolving, digital-native strata formation.
