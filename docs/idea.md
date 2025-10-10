# Idea

Document future enhancements for the polygon drawing sandbox.

- Capture new polygon fill techniques to explore.
- Record UX experiments for intuitive controls.
- Track questions that need research before implementation.

## Fill technique concepts

- **Voronoi shards:** Partition the polygon into relaxed Voronoi cells seeded along the outline, then clip subtle hatch or gradient fills per cell for crystalline facets.
- **Spiral bloom:** Grow gently perturbed logarithmic spirals from the centroid or corners and animate phase offsets for a hand-drawn floral swirl.
- **Magnetic field:** Place one or two dipole poles and trace the resulting vector-field streamlines, reusing the flow sampler for elegant looping currents.
- **Watercolor wash:** Layer translucent noise-driven blobs clipped to the shape, jittering hue and saturation per layer to mimic soft watercolor bleeds.
- **Fabric weave:** Interleave two orthogonal ribbon sets with low-frequency width modulation and alternating colors to evoke woven textile strands.
- **Isoline glow:** Sample distance-to-edge, draw quantized contour bands with overlapping blur or alpha to create neon topography highlights.
- **Mosaic tessellation:** Tile the interior with jittered hex or triangle shards using centroidal relaxation, then outline each shard for a stained-glass effect.

## HeavyPaint-inspired oil brush plan

- Anchor aesthetics to HeavyPaint’s expressive color jitter, rake-like multi-tooth strokes, and minimalist controls to keep the brush tailored for digital impressionism.
- Target stylus pressure, tilt, rotation, and stroke velocity as primary inputs; expose secondary sliders for per-bristle stiffness, spacing jitter, and paint load so artists can tune "bristly level" detail without clutter.
- Represent the brush as a bundle of 50–100 bristle splines with per-tip paint reservoirs; blend particle-based near-field paint with a surface density field to model oil smearing efficiently.
- Run the hybrid paint simulation on GPU compute (compute shaders/CUDA/Metal) to keep bristle dynamics, transfer, and diffusion responsive on tablets and desktops.
- Combine a viscous oil material model (pressure-driven flow, tack drag) with HeavyPaint-style stochastic hue/value offsets gated by pressure for crunchy, physical strokes.
- Mirror HeavyPaint’s quick-access UI by dedicating sliders to bristle spread, clumping, solvent mix, and jitter macros while leaving the canvas unobstructed.
- Prototype in three passes: (1) stylus-to-bristle rig with static imprint, (2) live bristle deformation plus hybrid paint solver, (3) expressive modifiers (fan/rake presets, jitter macros) and platform performance tuning.
- Validate by recreating HeavyPaint benchmark strokes (fan foliage, block gradients) and iterating on solver stability, latency, and ergonomics with artist feedback.

## GPU Diffusion Prototype

- Anchor a dedicated module (`src/gpu/diffusionPass.js`) that spins up the GPU context once (Metal via `MTLComputePipelineState`, WebGL2 via `OES_texture_float` + compute/fragment workaround) and exposes `initDiffusion(surfaceSize)`, `stepParticles(stylusSamples)`, and `resolveSmear(targetFBO)` so `ExpressiveBrushEngine` can stay lean.
- Represent each near-field particle as a tightly packed struct (position.xy, velocity.xy, paint.rgb, load, lifetime) in an SSBO/texture buffer; mirror the smear field as a 2-channel fp16 RG texture storing accumulated pigment and viscosity, updated via ping-pong buffers to keep reads and writes isolated.
- Run two compute kernels per frame: `advectParticles` updates particles under stylus forces, transfers paint, and accumulates pigment into a scatter buffer using atomics; `diffuseField` applies a separable blur with viscosity weighting to push pigment into the smear texture while clamping the timestep to ≤1/60 s for stability.
- Feed bristle tip impacts into a small ring buffer uploaded each frame so the GPU pass can spawn or refresh particles near fresh paint, keeping smear response tightly coupled to the stylus.
- After diffusion, bind the smear texture in `blitToTarget` and blend it with the stroke canvas using `glBlendFuncSeparate` plus a brush-size-dependent normal map lookup for HeavyPaint-style lift, keeping the CPU 2D canvas path as a fallback for unsupported GPUs.
- Add a UI toggle for GPU diffusion and lightweight diagnostics logging (`frameTime`, `dispatchCount`, `gpuSync`) to tune workgroup sizes before layering on Pass 3 presets.
- Validate against HeavyPaint benchmark strokes, logging GPU frame budgets on target hardware and cross-checking smear density against a CPU reference tile before shipping.





