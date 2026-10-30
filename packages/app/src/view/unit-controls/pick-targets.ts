import { pickTopAt } from '../picking.js';
import type { UnitTargetKind, UnitTargets } from './unit-targets.js';

/** A world-px point a press or the cursor names. */
interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** The frontmost enemy of one of `kinds` at `world`. `neutralWalls` adds the unowned palisades, which
 *  only an army's explicit strike takes. */
export function enemyAt(
  targets: UnitTargets,
  world: WorldPoint,
  kinds: readonly UnitTargetKind[],
  neutralWalls = false,
): number | null {
  const accepted = targets
    .enemies({ neutralWalls })
    .filter((target) => target.kind !== undefined && (kinds as readonly string[]).includes(target.kind));
  return pickTopAt(accepted, world.x, world.y);
}

/** The frontmost wild creature at `world`. */
export const preyAt = (targets: UnitTargets, world: WorldPoint): number | null =>
  pickTopAt(targets.wildlife(), world.x, world.y);

/** The frontmost own vehicle at `world`, other than `except`. */
export const ownVehicleAt = (targets: UnitTargets, world: WorldPoint, except?: number): number | null =>
  pickTopAt(
    targets.owned('vehicle').filter((target) => target.ref !== except),
    world.x,
    world.y,
  );

/** The frontmost own settler at `world`. */
export const ownSettlerAt = (targets: UnitTargets, world: WorldPoint): number | null =>
  pickTopAt(targets.owned('settler'), world.x, world.y);
