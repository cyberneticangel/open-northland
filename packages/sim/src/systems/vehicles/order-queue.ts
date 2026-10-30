import type { AiOrderOrigin } from '../../components/ai/order.js';
import {
  dropVehicleOrderQueue,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  QUEUEABLE_VEHICLE_ORDER_KINDS,
  type QueueableVehicleOrderCommand,
  type QueuedVehicleOrder,
  Vehicle,
  VehicleDrive,
  VehicleOrderQueue,
  vehicleCommander,
} from '../../components/index.js';
import { assertNever } from '../../core/brand.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { ownAttackTarget } from '../conflict/engage-vehicle.js';
import type { System, SystemContext } from '../context.js';
import {
  pushQueuedOrder,
  queueChangedHands,
  queuedOrderAuthorized,
  startQueuedOrders,
} from '../orders/queued.js';
import { loadIntoVehicle } from './boarding.js';
import { unloadPeople } from './crew.js';
import { dockVehicle } from './dock.js';
import { moveVehicle } from './movement.js';
import { attackWithVehicle } from './orders.js';

const QUEUEABLE_KINDS: ReadonlySet<Command['kind']> = new Set(QUEUEABLE_VEHICLE_ORDER_KINDS);

/** Whether `command` asks to wait behind the vehicle's current order. */
export function isQueuedVehicleOrder(command: Command): command is QueueableVehicleOrderCommand {
  return QUEUEABLE_KINDS.has(command.kind) && 'queued' in command && command.queued === true;
}

/**
 * Whether vehicle `e` is carrying out an order that ends on its own: a goto or dock under way or held for
 * the boarding, an attack-move, an ordered attack on a unit, house or vehicle, or a drive into a ship
 * (which ends with the vehicle aboard, where the queue lapses, unless the load fails). A chase its own
 * scan picked is not waited for, nor a battered map point, which never ends.
 */
function holdsCurrentOrder(world: World, e: Entity): boolean {
  const state = world.get(e, Vehicle);
  if (state.march !== null || state.heldGoal !== null) return true;
  if (state.task === 'waitsForHuman' || state.task === 'docks' || state.task === 'boardsShip') return true;
  if (state.attack !== null) return state.attack.ordered && state.attack.target.kind === 'entity';
  return world.has(e, VehicleDrive);
}

/** Whether `e` may hold queued drives at all: someone commands it, it stands on the map, and no script
 *  took it out of the player's hands. */
function takesQueuedOrders(world: World, e: Entity): boolean {
  const state = world.get(e, Vehicle);
  return (
    vehicleCommander(state) !== null &&
    state.carrier === null &&
    !hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE)
  );
}

/**
 * Line a queued drive up behind the vehicle's current order. True when it was queued (or dropped past
 * `ORDER_QUEUE_LIMIT`); false when the vehicle has nothing to wait for or takes no queue, so the command
 * applies at once and a vehicle nobody commands refuses it as an unqueued one does.
 */
export function queueVehicleOrder(
  world: World,
  command: QueueableVehicleOrderCommand,
  origin?: AiOrderOrigin,
): boolean {
  const e = command.vehicle;
  if (!world.isAlive(e) || !world.has(e, Vehicle) || !takesQueuedOrders(world, e)) return false;
  return pushQueuedOrder(world, VehicleOrderQueue, e, unqueued(command, origin), () =>
    holdsCurrentOrder(world, e),
  );
}

/** A fresh copy without the queue flag, as the settler queue stores its orders. */
function unqueued(command: QueueableVehicleOrderCommand, origin?: AiOrderOrigin): QueuedVehicleOrder {
  const { queued: _queued, ...order } = command;
  const own =
    order.kind === 'attackWithVehicle' ? { ...order, target: ownAttackTarget(order.target) } : order;
  return { ...own, ...(origin === undefined ? {} : { aiOrder: { ...origin } }) };
}

/**
 * Start each vehicle's next queued drive once its current order is done. Scheduled right after the drives
 * advance, so a queued drive starts on the tick the one ahead arrives, before the combat pass could scan
 * from a vehicle standing idle between two legs. A drive refused at its start is skipped for the next
 * one. A vehicle that no longer takes queued drives, or one handed to another player, drops its queue.
 */
export const vehicleOrderQueueSystem: System = (world, ctx) => {
  // Collected first: putting the rest back re-adds the component under the query.
  for (const e of [...world.query(Vehicle, VehicleOrderQueue)]) {
    if (!takesQueuedOrders(world, e) || queueChangedHands(world, VehicleOrderQueue, e)) {
      dropVehicleOrderQueue(world, e);
      continue;
    }
    if (holdsCurrentOrder(world, e)) continue;
    startQueuedOrders(
      world,
      VehicleOrderQueue,
      e,
      () => holdsCurrentOrder(world, e),
      (order, owner) => startQueuedOrder(world, ctx, order, owner),
    );
  }
};

function startQueuedOrder(world: World, ctx: SystemContext, queued: QueuedVehicleOrder, owner: number): void {
  const { aiOrder: origin, ...command } = queued;
  if (!queuedOrderAuthorized(world, ctx, command, origin, owner)) return;
  switch (command.kind) {
    case 'moveVehicle':
      moveVehicle(world, ctx, command, undefined, origin);
      return;
    case 'dockVehicle':
      dockVehicle(world, ctx, command, origin);
      return;
    case 'attackWithVehicle':
      attackWithVehicle(world, ctx, command, origin);
      return;
    case 'loadIntoVehicle':
      loadIntoVehicle(world, ctx, command);
      return;
    case 'unloadPeople':
      unloadPeople(world, ctx, command);
      return;
    default:
      assertNever(command);
  }
}
