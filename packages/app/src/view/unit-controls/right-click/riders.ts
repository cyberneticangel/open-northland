import { entityById, MAX_UNIT_ORDER_MEMBERS, systems } from '@open-northland/sim';
import { isVehicle, num, positionOf, vehicleSeatsOf } from '../../../game/snapshot/index.js';
import { contentLookups, type PendingAnswer, type RightClickHit } from './context.js';
import { type LadderContext, tradeHouseSplit } from './settler-ladder.js';

export type RiderPlan =
  /** Nobody off the map trades with the house: the selected vehicles take the click. */
  | { readonly kind: 'none' }
  | { readonly kind: 'orderLimit' }
  | {
      readonly kind: 'tradeHouse';
      readonly house: number;
      readonly detach: readonly number[];
      readonly ask: readonly number[];
      readonly pending?: PendingAnswer;
    };

/**
 * The trade-route toggle for the selected traders off the map (riding inside a cart, or inside a
 * house), which the settlers' ladder skips, and for the crew or the puller of a selected cart, whose
 * window shows its trader's route. A ship's passengers are left out: the ship takes the click itself, as its window has
 * no Trade tab. A trade stop is a standing setting, so a `queued` click leaves a cart's trader to the
 * cart, which drives there queued; a trader inside a house has nowhere to walk and still toggles it.
 */
export function resolveRiderTrade(
  ctx: LadderContext,
  selected: ReadonlySet<number>,
  hit: RightClickHit,
  queued: boolean,
  onBuilding: number | null,
): RiderPlan {
  const { snapshot } = ctx;
  const traders = new Map<number, { readonly ref: number }>();
  for (const id of selected) {
    const e = entityById(snapshot, id);
    if (e === undefined) continue;
    if (!isVehicle(e)) {
      const riding = e.components.Rider !== undefined;
      if (positionOf(e) === undefined && !(queued && riding) && !traders.has(id))
        traders.set(id, { ref: id });
      continue;
    }
    if (queued) continue;
    const v = e.components.Vehicle as { vehicleType?: unknown; passengers?: unknown; hauler?: unknown };
    const type = contentLookups(ctx.content).vehicles.get(num(v.vehicleType) ?? -1);
    if (type === undefined || systems.isShipVehicle(type)) continue;
    for (const seat of vehicleSeatsOf(v.passengers))
      if (!traders.has(seat.entity)) traders.set(seat.entity, { ref: seat.entity });
    const hauler = num(v.hauler);
    if (hauler !== undefined && !traders.has(hauler)) traders.set(hauler, { ref: hauler });
  }
  if (traders.size === 0) return { kind: 'none' };
  if (traders.size > MAX_UNIT_ORDER_MEMBERS) return { kind: 'orderLimit' };
  const house = onBuilding ?? hit.building;
  if (house === null) return { kind: 'none' };
  const { detach, ask } = tradeHouseSplit(ctx, [...traders.values()], house);
  if (detach.length + ask.length === 0) return { kind: 'none' };
  return {
    kind: 'tradeHouse',
    house,
    detach,
    ask,
    ...(ask.length > 0 ? { pending: 'tradeAttach' as const } : {}),
  };
}
