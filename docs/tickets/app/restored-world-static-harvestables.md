# Keep the static harvestables of a restore without a fog memory

**Area:** app, render · **Focus:** save/load, performance · **Priority:** P3

A save now carries the saving seat's static layer memory, and a load into that seat keeps every quad the
viewer last saw (`view/map-objects/static-layer.ts`). A restore without that memory still retires the
whole harvestable bake up front: another seat loading the save, an observer, or a memory dropped as
malformed or from another map. Every tree and bush then becomes pool-drawn for the rest of the session,
thousands of quads moved from a built-once layer into per-frame work, and the forest stands still, since
the pool draws a standing node as one still frame per level while the static layer plays its sway loop.

## Scope

- Measure such a restore against a fresh boot on the same real map, at the late-game x3 speed budget,
  reporting process CPU time (`docs/DEVELOPMENT.md` says which tool answers which question).
- If the cost is material, keep the quad for every node the restored world still holds intact and retire
  only the rest; the match has to come from the placement's own node, since no memory names the entity.

## Verify

- A numbered before/after on the same map and save, with the interleaved A/B the perf docs require.
- A loaded world draws each harvestable exactly once, with no resurrected node after felling, and its
  intact trees sway as on a fresh boot.
- `npm run check`, `npm run build`, `npm test`, plus a browser pass on a real map.
