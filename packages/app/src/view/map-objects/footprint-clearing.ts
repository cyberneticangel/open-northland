import {
  type BuildingFootprint,
  buildingFootprintFor,
  type FootprintCell,
  firstByTypeId,
  footprintCellDx,
} from '@open-northland/data';
import { roadShardOf } from '@open-northland/render/data';
import {
  entitiesWith,
  entityById,
  nodeOfPosition,
  type SimEvent,
  type WorldSnapshot,
} from '@open-northland/sim';
import { forEachPlacement } from '../../content/map/placements.js';
import {
  buildingRecordOf,
  buildingTribeOf,
  buildingTypeOf,
  isBuilding,
  positionOf,
  type SnapshotEntity,
} from '../../game/snapshot/index.js';
import type { StaticDrawSurface } from './harvestable-handover.js';
import type { SightDeferral } from './sight-deferral.js';

/** The slice of a building type the clearing reads: each tribe's and each house record's walk-block
 *  cells. */
export interface FootprintBuildingType {
  readonly typeId: number;
  readonly footprint?: Pick<BuildingFootprint, 'blocked'> | undefined;
  readonly tribeVariants: readonly {
    readonly tribe: number;
    readonly footprint?: Pick<BuildingFootprint, 'blocked'> | undefined;
  }[];
  readonly recordFootprints?: readonly {
    readonly tribe: number;
    readonly editName: string;
    readonly footprint: Pick<BuildingFootprint, 'blocked'>;
  }[];
}

function nodeKey(hx: number, hy: number): string {
  return `${hx},${hy}`;
}

/**
 * A building's walk-block footprint and the nodes a road or wall covers are bare ground: the static
 * sprites on them leave the layer when the building is placed or upgraded or the road or wall ordered,
 * and at bind for every building, road, road site and wall already there (original behavior: a house's
 * placement removes the landscape objects in its walk-block area). Ground cleared later under the
 * viewer's fog keeps its scenery until the viewer sees it. `deferAtBind` holds back the clearing at bind
 * too, for a layer restored as the viewer last saw it. `nodeWidth` is the map's width in half-cell nodes,
 * the stride of the road network's node ids.
 */
export function bindFootprintClearing<Sprite>(
  surface: Pick<StaticDrawSurface<Sprite>, 'removeMapObject'>,
  placements: readonly number[],
  spriteByPlacement: ReadonlyMap<number, Sprite>,
  content: { readonly buildings: readonly FootprintBuildingType[] },
  snapshot: () => WorldSnapshot,
  nodeWidth: number,
  sight: SightDeferral,
  deferAtBind = false,
): (events: readonly SimEvent[]) => void {
  // First-wins, the index the sim resolves a type's footprint through.
  const buildingsByType = firstByTypeId(content.buildings);
  const standing = new Map<string, { readonly placement: number; readonly sprite: Sprite }[]>();
  forEachPlacement(placements, (hx, hy, _type, ordinal) => {
    const sprite = spriteByPlacement.get(ordinal);
    if (sprite === undefined) return;
    const key = nodeKey(hx, hy);
    const at = standing.get(key);
    if (at === undefined) standing.set(key, [{ placement: ordinal, sprite }]);
    else at.push({ placement: ordinal, sprite });
  });

  // The map's own buildings, roads and walls clear at once; later ones wait for the viewer's sight.
  let deferred = deferAtBind;
  const clearAt = (hx: number, hy: number): void => {
    const key = nodeKey(hx, hy);
    const at = standing.get(key);
    if (at === undefined) return;
    standing.delete(key);
    for (const { placement, sprite } of at) {
      if (deferred) sight.defer(placement, hx, hy, () => surface.removeMapObject(sprite));
      else surface.removeMapObject(sprite);
    }
  };

  const clearUnder = (building: SnapshotEntity): void => {
    const type = buildingTypeOf(building);
    const pos = positionOf(building);
    if (type === undefined || pos === undefined) return;
    const def = buildingsByType.get(type);
    const cells =
      (def === undefined
        ? undefined
        : buildingFootprintFor(def, buildingTribeOf(building), buildingRecordOf(building))
      )?.blocked ?? [];
    const { hx, hy } = nodeOfPosition(pos.x, pos.y);
    for (const cell of cells) clearAt(hx + footprintCellDx(hy, cell), hy + cell.dy);
  };

  const bound = snapshot();
  for (const entity of bound.entities) {
    if (isBuilding(entity)) clearUnder(entity);
    else clearUnderLine(entity, clearAt);
  }
  for (const carrier of entitiesWith(bound, 'RoadShard')) {
    for (const node of roadShardOf(carrier)?.nodes ?? []) {
      const hx = node % nodeWidth;
      clearAt(hx, (node - hx) / nodeWidth);
    }
  }
  deferred = true;

  return (events) => {
    let snap: WorldSnapshot | undefined;
    for (const event of events) {
      if (event.kind === 'groundCleared') {
        for (const { hx, hy } of event.nodes) clearAt(hx, hy);
        continue;
      }
      if (event.kind !== 'buildingPlaced' && event.kind !== 'buildingUpgraded') continue;
      snap ??= snapshot();
      const building = entityById(snap, event.entity);
      if (building !== undefined) clearUnder(building);
    }
  };
}

/** The nodes a road site or a wall stands on: a site's own node, a wall's placement body. */
function clearUnderLine(entity: SnapshotEntity, clearAt: (hx: number, hy: number) => void): void {
  const pos = positionOf(entity);
  if (pos === undefined) return;
  const { hx, hy } = nodeOfPosition(pos.x, pos.y);
  if (Object.hasOwn(entity.components, 'RoadSite')) {
    clearAt(hx, hy);
    return;
  }
  const wall = entity.components.Palisade;
  if (typeof wall !== 'object' || wall === null) return;
  const { placementWalk } = wall as { readonly placementWalk?: unknown };
  if (!Array.isArray(placementWalk)) return;
  for (const cell of placementWalk as readonly FootprintCell[]) {
    clearAt(hx + footprintCellDx(hy, cell), hy + cell.dy);
  }
}
