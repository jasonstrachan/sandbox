# Agent Digest

Artifacts (boxes, bottles, shards, etc.) behave as long-lived **agents** inside the deformable stack. Each agent keeps its mesh identity from spawn until it becomes sediment, so the same rules cover visual continuity, physics budgets, and scheduling. This digest condenses the detailed requirements from `docs/spec.md` so prototype authors can reason about agents without rereading the full spec.

## North Star Goals

1. **Living Digital Painting (2D):** Continuously evolving canvas; strata read like geology.
2. **Concurrent Mesh Deformation:** Many meshes fall and deform in parallel, each with distinct material response.
3. **Persisting Identity:** Each mesh’s outline remains traceable from spawn to burial.
4. **Depth-Aware Compaction:** Deeper layers compact, shear, and desaturate more than fresh ones.
5. **Stack-Wide Influence:** New weight propagates through the stack; buried artifacts remain responsive.
6. **Organic Determinism:** XPBD with fixed dt, seeded RNG, stable ordering, and quantized writes.

## Lifecycle & Scheduling

| Tier      | Update cadence | Constraint budget | Purpose |
|-----------|----------------|-------------------|---------|
| **Active** | Every frame, 2–3 substeps, 6–10 iterations | Stretch + area + bend + contacts | Falling or colliding meshes counted against `N_max` (target 8). |
| **Resting** | Every frame, fewer iterations (≈4) | May thin expensive bend constraints | Newly settled meshes on the surface; still respond to fresh drops. |
| **Buried** | At least once every 4 frames | Stretch + area + attachments; plasticity throttled | Primary channel for transmitting overburden down the stack. |
| **Dormant** (optional) | Reactivated only when local stress spikes | Outline + landmark set retained | Long-term archival state for very deep strata. |

Scheduling rules:
- `N_max = 8` active meshes, 50–100 particles each, keeps total particles within ~300–960.
- Buried/dormant meshes still receive identity-preserving updates so their outlines can surface via compaction or erosion animations later.

## Canonical Silhouettes (v0.x)

Agents spawn from a fixed library of silhouettes. Each comes with a target particle lattice so performance and determinism remain bounded.

| ID | Description | Outline vertices | Target lattice |
|----|-------------|------------------|----------------|
| Box / Carton | Slightly chamfered shipping box | 8–10 | 8×8 or 10×10 (64–100 particles) |
| Flat Tag / Mailer | Rounded rectangle with notch option | 8–12 | 6×8 (~48) |
| Bottle | Simplified PET/glass profile | 12–16 | 10×12 (~120) or 8×10 (~80) |
| Phone / Slab | Rounded rectangle with screen detail | 8–10 | 8×10 (80) |
| Irregular Fragment | Single-concavity shard | 6–10 | 6×6 or 6×8 (36–48) |
| Handbag / Tote | Soft trapezoid + curved handles | 14–20 | 10×12 (~120) |
| Bicycle Chunk | Frame + two wheel arcs | 18–26 | 12×14 (~168), limit to 1–2 active |
| Skull Icon | Stylised single-contour skull | 16–24 | 10×12 or 12×12 (~120–144) |

> v0.x enforces **single outer contours**; holes are visual only. Multi-loop physics is deferred to v1.x.

## Spawn, Identity, and Determinism

- Spawns originate from queued `SpawnEvent{ frame, seed, params }` objects; the fixed-dt loop releases them exactly on `frame`.
- Placement performs AABB tests plus seeded, quantized horizontal jitter so identical seeds always yield the same pose.
- Back-pressure kicks in once `N_max` active meshes are present; additional events are deferred or dropped with reason codes.
- Each agent stores its boundary vertex set (indices into the particle slice). This set is never garbage collected, ensuring outlines remain renderable after burial.
- Buried agents keep receiving solver updates (at a reduced cadence) so stack-wide pressure still deforms them.

## Material Profiles per Agent

Each agent references a `MaterialProfile`:

```ts
type MaterialProfile = {
  density: number;
  compliance: { stretch: number; area: number; bend?: number };
  friction: { static: number; kinetic: number; restitution: number };
  plastic: { beta: number; yieldStrain: number; yieldBendDeg: number };
  damping: { velocity: number; writeback: number };
  gridCouplingScale: number;
  baseHue: number;
};
```

Key expectations:
- Compliance values map directly to XPBD α; softer stretch compliance yields visibly higher impact strain.
- Density differences must produce measurable depth changes under identical loading (acceptance test).
- Friction combines Coulomb stick/slip with a tangential clamp `|J_t| ≤ μ J_n`; restitution ≈ 0.
- Plastic drift only activates when combined stress/strain metrics exceed 1.0, using `β_plastic ≈ 0.02–0.05 s⁻¹`.

## Collision & Contact Behavior

- Boundary vertices use CCD during the first 0.25 s of life to prevent tunneling.
- Spatial hashing with deterministic ordering batches contact constraints per island.
- Symmetry tests (drop order A→B vs. B→A) must yield consistent, non-explosive interactions; penetration depth stays below `ε_pen`.

## Identity Persistence & Rendering

- Agents never convert to raster stamps; even deep layers retain their mesh representation.
- Rendering uses the stored boundary vertices with age/depth fades, ensuring “geological record” visuals.
- Global RNG (xoshiro128-style) drives every stochastic effect so replays are bit-stable across platforms.

For the full rationale and acceptance criteria, see the source material in `docs/spec.md`.
