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

revert?