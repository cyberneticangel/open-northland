import { Building, TrainingOrder } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/** The settlers `house` trains at once, its `logicSchoolSize`; undefined seats everyone sent there. */
export function trainingSeats(world: World, ctx: SystemContext, house: Entity): number | undefined {
  const building = world.tryGet(house, Building);
  if (building === undefined) return undefined;
  return contentIndex(ctx.content).buildings.get(building.buildingType)?.schoolSize;
}

/** Whether `a` joined its house's list before `b`: the earlier tick, then the lower id. */
export function enrolledBefore(
  a: { readonly id: number; readonly enrolled: number },
  b: { readonly id: number; readonly enrolled: number },
): boolean {
  return a.enrolled < b.enrolled || (a.enrolled === b.enrolled && a.id < b.id);
}

/**
 * Seat `e` at its training house when a seat is free and nobody enrolled before it still waits; true when
 * it holds one. A seated order never loses its seat, so the scan runs only for the ones still waiting.
 */
export function takeTrainingSeat(world: World, ctx: SystemContext, e: Entity): boolean {
  const order = world.tryGet(e, TrainingOrder);
  if (order === undefined) return false;
  if (order.seated) return true;
  const capacity = trainingSeats(world, ctx, order.house);
  if (capacity !== undefined) {
    const me = { id: e, enrolled: order.enrolled };
    let ahead = 0;
    for (const other of world.query(TrainingOrder)) {
      if (other === e) continue;
      const theirs = world.get(other, TrainingOrder);
      if (theirs.house !== order.house) continue;
      if (theirs.seated || enrolledBefore({ id: other, enrolled: theirs.enrolled }, me)) ahead++;
    }
    if (ahead >= capacity) return false;
  }
  world.mut(e, TrainingOrder).seated = true;
  return true;
}

/** Whether `house` still has a seat no order has claimed, seated or waiting; a house without a size has. */
export function hasUnclaimedSeat(world: World, ctx: SystemContext, house: Entity): boolean {
  const capacity = trainingSeats(world, ctx, house);
  if (capacity === undefined) return true;
  let claimed = 0;
  for (const e of world.query(TrainingOrder)) if (world.get(e, TrainingOrder).house === house) claimed++;
  return claimed < capacity;
}
