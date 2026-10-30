import { type FootprintCell, footprintCellDx } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { type HalfCellNode, hexDistance } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { houseFootprintOf } from '../../footprint/geometry.js';
import { placementBlockCells } from '../../landscape/footprint.js';
import { landscapesWithin, landscapeTypes } from '../../landscape/view.js';
import { createSpatialMemo } from '../../spatial/memo.js';
import { NodeBuckets } from '../../spatial/nodes.js';
import type { MissionPass } from '../pass.js';

// Buildings keep their anchor for their lifetime. Membership changes alone update these buckets;
// the footprint is read live, so an upgrade needs no spatial reindexing.
const buildings = createSpatialMemo<NodeBuckets, HalfCellNode>(
  Building,
  { verifier: 'explorationBuildings', plural: 'buildings', component: 'Building' },
  {
    empty: (world) => new NodeBuckets(world, []),
    member: (_world, _entity, hx, hy) => ({ hx, hy }),
    insert: (buckets, entity, point) => buckets.insert(entity, point.hx, point.hy),
    remove: (buckets, entity, point) => buckets.remove(entity, point.hx, point.hy),
    diverges: (held, fresh) => {
      for (const bucket of fresh.buckets()) {
        const previous = held.at(bucket.x, bucket.y);
        if (previous.length !== bucket.entities.length || bucket.entities.some((e, i) => previous[i] !== e)) {
          return ['explorationBuildings differs from current building anchors'];
        }
      }
      return [];
    },
  },
);

const landscapeReach = new WeakMap<TerrainGraph, number>();

/** Conservative radius of a landscape's walk body, including every authored growth level. */
function maximumLandscapeReach(terrain: TerrainGraph): number {
  const held = landscapeReach.get(terrain);
  if (held !== undefined) return held;
  let reach = 0;
  for (const type of landscapeTypes(terrain).values()) {
    for (const cell of type.walk) reach = Math.max(reach, Math.abs(cell.dx) + Math.abs(cell.dy) + 1);
    for (const [, dx, dy, run] of type.blockAreas?.walk ?? []) {
      reach = Math.max(reach, Math.abs(dx) + Math.abs(dy) + run + 1);
    }
  }
  landscapeReach.set(terrain, reach);
  return reach;
}

/** Reveal authored build-exclusion areas touched by the original hexagon, without cascading into
 *  neighbouring objects. House anchors trigger their area; landscape walk cells trigger theirs.
 *  Data basis: LogicBuildBlockArea and LogicWalkBlockArea. Trigger details remain unconfirmed in the
 *  running original. */
export function exploreObjectAreas(
  pass: MissionPass,
  player: number,
  point: HalfCellNode,
  range: number,
): void {
  const { world, ctx } = pass;
  const { terrain, fog } = ctx;
  if (terrain === undefined || fog === undefined) return;
  const reveal = (anchor: HalfCellNode, cells: readonly FootprintCell[]): void => {
    for (const cell of cells) {
      const hx = anchor.hx + footprintCellDx(anchor.hy, cell);
      const hy = anchor.hy + cell.dy;
      if (terrain.inBounds(hx, hy)) fog.revealArea(player, { hx, hy }, 0);
    }
  };
  const atNode = buildings.read(world);
  for (let hy = Math.max(0, point.hy - range); hy <= Math.min(terrain.height - 1, point.hy + range); hy++) {
    for (let hx = Math.max(0, point.hx - range); hx <= Math.min(terrain.width - 1, point.hx + range); hx++) {
      const anchor = { hx, hy };
      if (hexDistance(point, anchor) > range) continue;
      for (const entity of atNode.at(hx, hy)) {
        const building = world.get(entity, Building);
        const footprint = houseFootprintOf(ctx.content, building);
        if (footprint !== undefined) reveal(anchor, footprint.reserved);
      }
    }
  }
  const types = landscapeTypes(terrain);
  for (const placement of landscapesWithin(world, terrain, point, range + maximumLandscapeReach(terrain))) {
    const type = types.get(placement.typeId);
    if (type === undefined) continue;
    const cells = placementBlockCells(type, placement.level);
    const touched = cells.walk.some(
      (cell) =>
        hexDistance(point, {
          hx: placement.hx + footprintCellDx(placement.hy, cell),
          hy: placement.hy + cell.dy,
        }) <= range,
    );
    if (touched) reveal(placement, cells.build);
  }
}
