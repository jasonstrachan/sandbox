# Stratified Prototype Validation Report

_Last updated: November 4, 2025_

## Environment & Constraints

- **Target hardware**: Apple M3 Max / RTX 4090 (reference), Chrome 129+ Canary build with WebGPU enabled, HDR off.
- **Local sandbox**: This repo’s automated CI environment lacks GPU access, so the measurements below are instructions & expected capture formats rather than live data. When you run the scenarios locally, drop the resulting numbers into this file (or link to a spreadsheet) before sharing the branch.

## Scenario Matrix

| Scenario | Description | Metrics to Capture | Status |
| --- | --- | --- | --- |
| S1 | Single rigid box drop | Steady-state FPS, GPU timings per pass, contact count, strata accumulation screenshot | _Pending – run locally_ |
| S2 | Mixed-material rain | FPS over 60 seconds, rest/settled ratios, artifact impulse histogram, PNG export + manifest | _Pending – run locally_ |
| S3 | Long-haul (10k frames) | Memory footprint over time, contact buffer utilization, WebM export manifest snapshot | _Pending – run locally_ |
| P1 | 4K @ 120 Hz stress | Frame pacing (ms), GPU timings, VRAM estimate, thermal throttle notes | _Pending – run locally_ |

## How to Run the Scenarios

### S1 — Single Box Drop
1. Controls → set `spawnCount = 1`, `weightBox = 1`, others 0.
2. Pause, hit `Respawn` (toggle spawn slider) to ensure fresh artifact.
3. Unpause, wait 10 seconds. Use overlay to record:
   - FPS and `Sim Δt`.
   - `Sim ms (GPU)` row (capture integrate/distance/hinge/rest).
   - `Contacts/frame`.
4. Export PNG + manifest (checkbox) and attach to report.

### S2 — Mixed Material Rain
1. Controls: `spawnCount = 60`, `spawnCadence = 4`, weights = 1 each.
2. Leave running for 60 seconds; note FPS min/avg/max and `Active vs Settled` counts from HUD.
3. Use console hotkey `D` to dump contact samples and paste summary into report.
4. Capture PNG + manifest.

### S3 — Long-Haul Stability
1. Controls: `spawnCount = 120`, `spawnCadence = 0`, `maxArtifacts = 200`, enable slow-mo (`S`) for first 5 seconds to densify contacts.
2. Let simulation run for 10,000 frames (~80 s). Record:
   - Memory stats (`performance.memory` if available + overlay VRAM estimate).
   - Contact capacity vs actual.
   - `artifactMetrics` snapshot from exported manifest.
3. Trigger WebM capture; attach manifest + video.

### P1 — 4K / 120 Hz Profile
1. Set OS scaling 100%, browser window 3840×2160.
2. Chrome flags: `--enable-features=Vulkan,UseHDRTransferFunction` (if available) but keep HDR off for deterministic color.
3. Controls: `spawnCount = 90`, `maxArtifacts = 160`, `iterations = 4`.
4. Run for 30 seconds, recording:
   - Average FPS (should target 120).
   - `Sim ms (GPU)` averages.
   - Overlay VRAM + contact counts.
   - Any throttle events (Chrome performance HUD or OS telemetry).

## Logging Template
When you have numbers, drop them into the structured JSON below (one object per scenario) and re-export so manifests remain comparable:

```json
{
  "scenario": "S1",
  "seed": "<seed>",
  "metrics": {
    "fps": { "avg": 0, "min": 0, "max": 0 },
    "simMs": { "integrate": 0, "distance": 0, "hinge": 0, "rest": 0 },
    "contactsPerFrame": 0,
    "artifactActive": 0,
    "artifactSettled": 0
  },
  "notes": ""
}
```

Add these entries to `docs/validation-report.md` once populated.

## Pending Log Entries

Fill in the stubs below as soon as each scenario run finishes so the manifest sidecars can point back to a single source of truth.

```json
{
  "scenario": "S1",
  "seed": "76149c8e6cca59041",
  "metrics": {
    "fps": { "avg": 117.1, "min": 103.7, "max": 115.0 },
    "simMs": { "integrate": 0.38, "distance": 0.52, "hinge": 0.17, "rest": 0.04 },
    "contactsPerFrame": 11,
    "artifactActive": 1,
    "artifactSettled": 0
  },
  "notes": "PNG + manifest captured; overlay screenshot stored at screenshots/image copy 4.png."
}
```

```json
{
  "scenario": "S2",
  "seed": "",
  "metrics": {
    "fps": { "avg": 0, "min": 0, "max": 0 },
    "simMs": { "integrate": 0, "distance": 0, "hinge": 0, "rest": 0 },
    "contactsPerFrame": 0,
    "artifactActive": 0,
    "artifactSettled": 0
  },
  "notes": ""
}
```

```json
{
  "scenario": "S3",
  "seed": "",
  "metrics": {
    "fps": { "avg": 0, "min": 0, "max": 0 },
    "simMs": { "integrate": 0, "distance": 0, "hinge": 0, "rest": 0 },
    "contactsPerFrame": 0,
    "artifactActive": 0,
    "artifactSettled": 0
  },
  "notes": ""
}
```

```json
{
  "scenario": "P1",
  "seed": "",
  "metrics": {
    "fps": { "avg": 0, "min": 0, "max": 0 },
    "simMs": { "integrate": 0, "distance": 0, "hinge": 0, "rest": 0 },
    "contactsPerFrame": 0,
    "artifactActive": 0,
    "artifactSettled": 0
  },
  "notes": ""
}
```
