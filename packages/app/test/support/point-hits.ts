import type { DrawItem } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { isWildlife } from '../../src/game/snapshot/index.js';
import { isHitTarget, type Pickable, pickNearestAt, pickTopAt } from '../../src/view/picking.js';
import type {
  GoodHit,
  PileHit,
  PointHits,
  PointHitTargets,
  UnitTargets,
} from '../../src/view/unit-controls/unit-targets.js';

function goodAt(targets: readonly Pickable[], ref: number | null): GoodHit | null {
  const goodType = ref === null ? undefined : targets.find((target) => target.ref === ref)?.goodType;
  return ref === null || goodType === undefined ? null : { ref, goodType };
}

/** The frame's animals, which no order list holds, and a heap's amount, which no pickable carries. */
function creatureAt(
  drawn: readonly DrawItem[],
  snapshot: WorldSnapshot,
  wx: number,
  wy: number,
): number | null {
  const animals: Pickable[] = [];
  for (const item of drawn) {
    const entity = item.kind === 'settler' && isHitTarget(item) ? entityById(snapshot, item.ref) : undefined;
    if (entity !== undefined && isWildlife(entity))
      animals.push({ ref: item.ref, x: item.x, y: item.y, kind: 'settler' });
  }
  return pickTopAt(animals, wx, wy);
}

function pileAt(goods: readonly Pickable[], ref: number | null, drawn: readonly DrawItem[]): PileHit | null {
  const good = goodAt(goods, ref);
  if (good === null) return null;
  return { ...good, amount: drawn.find((item) => item.ref === good.ref)?.fill ?? 0 };
}

/** The point hits as picking over `targets`' own lists reads them, which the one-pass reading of the
 *  frame must agree with. An own wall counts as a site while `snapshot` has it under construction; the
 *  animals and the heap amounts come from `drawn`, without which there are none. */
export function pointHitsOfLists(
  targets: UnitTargets,
  wx: number,
  wy: number,
  snapshot?: WorldSnapshot,
  drawn: readonly DrawItem[] = [],
): PointHits {
  const enemies = targets.enemies();
  const goods = targets.goods();
  const resources = targets.resources();
  const walls = targets
    .owned('palisade')
    .filter(
      (wall) =>
        snapshot !== undefined && entityById(snapshot, wall.ref)?.components.UnderConstruction !== undefined,
    );
  return {
    ownSettler: pickTopAt(targets.owned('settler'), wx, wy),
    ownVehicle: pickTopAt(targets.owned('vehicle'), wx, wy),
    ownBuilding: pickTopAt(targets.owned('building'), wx, wy),
    site: pickTopAt([...walls, ...targets.owned('roadsite')], wx, wy),
    building: pickTopAt(targets.buildings(), wx, wy),
    enemy: pickTopAt(enemies, wx, wy),
    enemySettler: pickTopAt(
      enemies.filter((target) => target.kind === 'settler'),
      wx,
      wy,
    ),
    wildlife: pickTopAt(targets.wildlife(), wx, wy),
    claimableLivestock: pickTopAt(targets.claimableLivestock(), wx, wy),
    creature: snapshot === undefined ? null : creatureAt(drawn, snapshot, wx, wy),
    chest: pickTopAt(targets.chests(), wx, wy),
    pile: pileAt(goods, pickTopAt(goods, wx, wy), drawn),
    resource: goodAt(resources, pickNearestAt(resources, wx, wy)),
  };
}

/** A hand-built target list as the order controllers read it, its point hits picked from its lists. */
export function withPointHits(
  targets: UnitTargets,
  snapshot?: () => WorldSnapshot,
): UnitTargets & PointHitTargets {
  return { ...targets, pointHits: (wx, wy) => pointHitsOfLists(targets, wx, wy, snapshot?.()) };
}
