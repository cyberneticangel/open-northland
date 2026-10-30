import { describe, expect, it } from 'vitest';
import { Position, Settler, seatPassenger, VehicleDrive } from '../../../src/components/index.js';
import { contentIndex } from '../../../src/core/content-index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { nodeOfPosition, playerCommand, Simulation } from '../../../src/index.js';
import {
  cartDragTicks,
  cartLiftTicks,
  cartSpeedLossPercent,
  DRAWN_CART_FULL_SPEED_LOSS_PERCENT,
  DRAWN_CART_LIFT_PERCENT,
  HANDCART_FULL_SPEED_LOSS_PERCENT,
  HANDCART_LIFT_PERCENT,
} from '../../../src/systems/vehicles/drag.js';
import { boardRider, createVehicle } from '../../../src/systems/vehicles/index.js';
import { stockVehicleGoods } from '../../../src/systems/vehicles/stock.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

/**
 * A laden cart drags (owner's feature, a named addition): a vehicle's leg and a carrier's step with the
 * cart in hand cost extra ticks in proportion to how full the hold is, a handcart more than a cart an
 * animal draws, and an empty cart, a ship or the catapult nothing. A handcart lifts a unit faster than
 * an ox cart.
 */

const VIKING = 1;
const P0 = 0;
const HANDCART = 1;
const OXCART = 2;
const SHIP_SMALL = 3;
const CATAPULT = 5;
/** The fixture carts seat the carrier trade. */
const CARRIER = 24;
const WOOD = 1;
const MAP_NODES = 80;
const CART_AT = { hx: 20, hy: 20 };
const GOAL = { hx: 50, hy: 20 };
/** Headroom over a laden handcart's thirty-node drive at the grass period plus its drag. */
const DRIVE_TICKS = 1_000;

function sim(): Simulation {
  const s = new Simulation({ seed: 3, content: testContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
  s.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return s;
}

function typeOf(s: Simulation, typeId: number) {
  const type = contentIndex(s.content).vehicles.get(typeId);
  if (type === undefined) throw new Error(`vehicle type ${typeId} not in the fixture`);
  return type;
}

/** A cart with a commander inside and `load` wood aboard, ordered east. */
function drivenCart(s: Simulation, typeId: number, load: number): Entity {
  const cart = createVehicle(s.world, ctxOf(s), {
    vehicleType: typeId,
    ...CART_AT,
    x: CART_AT.hx,
    y: CART_AT.hy,
    tribe: VIKING,
    owner: P0,
  });
  if (cart === null) throw new Error('cart not in the fixture');
  s.enqueueSetup({
    kind: 'spawnSettler',
    jobType: CARRIER,
    x: CART_AT.hx,
    y: CART_AT.hy,
    tribe: VIKING,
    owner: P0,
  });
  s.step();
  let rider: Entity | undefined;
  for (const e of s.world.query(Settler)) rider = e;
  if (rider === undefined || !seatPassenger(s.world, cart, rider)) throw new Error('no commander');
  boardRider(s.world, rider, cart);
  if (load > 0) expect(stockVehicleGoods(s.world, cart, s.content, WOOD, load)).toBe(load);
  s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: cart, x: GOAL.hx, y: GOAL.hy }));
  return cart;
}

/** The ticks the drive takes to its end. */
function driveTicks(s: Simulation, cart: Entity): number {
  let ticks = 0;
  do {
    s.step();
    ticks++;
    if (ticks > DRIVE_TICKS) throw new Error('drive never ended');
  } while (s.world.has(cart, VehicleDrive) || ticks < 2);
  const p = s.world.get(cart, Position);
  expect(nodeOfPosition(p.x, p.y).hx).toBeGreaterThan(CART_AT.hx);
  return ticks;
}

describe('cartSpeedLossPercent', () => {
  it('scales the full drag by the share of the hold in use', () => {
    const s = sim();
    const handcart = typeOf(s, HANDCART);
    expect(cartSpeedLossPercent(s.content, handcart, 0)).toBe(0);
    expect(cartSpeedLossPercent(s.content, handcart, handcart.stockSlots / 3)).toBe(
      Math.floor(HANDCART_FULL_SPEED_LOSS_PERCENT / 3),
    );
    expect(cartSpeedLossPercent(s.content, handcart, handcart.stockSlots)).toBe(
      HANDCART_FULL_SPEED_LOSS_PERCENT,
    );
    const oxcart = typeOf(s, OXCART);
    expect(cartSpeedLossPercent(s.content, oxcart, oxcart.stockSlots)).toBe(
      DRAWN_CART_FULL_SPEED_LOSS_PERCENT,
    );
    expect(DRAWN_CART_FULL_SPEED_LOSS_PERCENT).toBeLessThan(HANDCART_FULL_SPEED_LOSS_PERCENT);
    expect(DRAWN_CART_FULL_SPEED_LOSS_PERCENT).toBeGreaterThan(0);
  });

  it('leaves a ship and the catapult alone', () => {
    const s = sim();
    const ship = typeOf(s, SHIP_SMALL);
    expect(cartSpeedLossPercent(s.content, ship, ship.stockSlots)).toBe(0);
    expect(cartSpeedLossPercent(s.content, typeOf(s, CATAPULT), 1)).toBe(0);
  });

  it('turns the speed loss into whole extra ticks of the move: half the speed doubles the ticks', () => {
    const groundPeriod = 6;
    const halfSpeed = 50;
    expect(cartDragTicks(groundPeriod, halfSpeed)).toBe(groundPeriod);
    expect(cartDragTicks(groundPeriod, 0)).toBe(0);
  });
});

describe('cartLiftTicks', () => {
  it('lifts a unit faster than the clip with a handcart and slower with an ox cart', () => {
    const s = sim();
    const clipTicks = 20;
    const hand = cartLiftTicks(s.content, typeOf(s, HANDCART), clipTicks);
    const ox = cartLiftTicks(s.content, typeOf(s, OXCART), clipTicks);
    expect(hand).toBe((clipTicks * HANDCART_LIFT_PERCENT) / 100);
    expect(ox).toBe((clipTicks * DRAWN_CART_LIFT_PERCENT) / 100);
    expect(hand).toBeLessThan(clipTicks);
    expect(ox).toBeGreaterThan(clipTicks);
  });
});

describe('a driven cart', () => {
  it('takes longer over the same road the fuller it is, the handcart more than the ox cart', () => {
    const empty = sim();
    const emptyTicks = driveTicks(empty, drivenCart(empty, HANDCART, 0));
    const laden = sim();
    const handcart = typeOf(laden, HANDCART);
    const ladenTicks = driveTicks(laden, drivenCart(laden, HANDCART, handcart.stockSlots));
    const ox = sim();
    const oxcart = typeOf(ox, OXCART);
    const oxTicks = driveTicks(ox, drivenCart(ox, OXCART, oxcart.stockSlots));
    expect(ladenTicks).toBeGreaterThan(emptyTicks);
    expect(oxTicks).toBeGreaterThan(emptyTicks);
    expect(oxTicks).toBeLessThan(ladenTicks);
  });
});
