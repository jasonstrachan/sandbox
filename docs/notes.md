Edited src/sim/state/simulation.js (+4 -4)
         facts);
    237 +    const buried = this.artifacts.filter((a
         rtifact) => (artifact.tier ?? 'active') ===
          'buried');
    238 +    if (buried.length) {
    239 +      this.grid.applyAttachments(buried);
    240 +    }
    241      const gridTime = now() - gridStart;
        ⋮
    653      this.artifacts.push(artifact);
    652 -    // TEMP: no initial attachment for acti
         ve meshes
    653 -    // this.grid?.applyAttachments([artifac
         t]);
    654      return artifact;

─ Worked for 10s ───────────────────────────────────

• Strata Attachments

  - src/sim/state/simulation.js:234-239 now filters
    artifacts by tier === 'buried' before calling
    grid.applyAttachments, so only strata-locked
    meshes feed deformation data back into the grid.
  - src/sim/state/simulation.js:642-654 drops
    the spawn-time attachment entirely, keeping
    new active meshes fully decoupled until they
    transition to the buried tier.

  Sim hasn’t been run here; recommend launching your
  usual build to confirm buried layers still advect
  while active meshes stay free.


  =-----

  The snippet you asked about is the bit
  inside StackSimulation.stepFixed that was
  filtering artifacts by tier and only calling
  grid.applyAttachments on those whose tier was
  'buried'. In plain terms:

  - Every frame, the strata grid reads where all
    artifacts are (that’s accumulateFromArtifacts
    + finalize). That part builds an internal
    “sediment” field representing compacted layers
    of material.
  - The removed block then tried to push motion
    back out of the grid only into artifacts that
    were already marked as buried. The idea was to
    keep “active” pieces (the ones still tumbling
    under XPBD) from being yanked upward by the
    strata’s vertical shifts, while still letting
    fully buried pieces move a little with the soil
    creep effect.
  - By filtering this.artifacts down to only
    the tier === 'buried' ones before calling
    applyAttachments, it intended to let the strata
    subtly advect true layers without injecting that
    motion into live meshes that should stay floppy.

  So, the “intended” behavior was: grid still
  listens to everyone, but only talks back to the
  layers that shouldn’t be deforming freely anymore.

revert?