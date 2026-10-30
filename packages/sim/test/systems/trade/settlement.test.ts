import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  HaulingCart,
  MissionObjectId,
  Owner,
  Position,
  Stockpile,
  setStockAmount,
  TRADE_LIMIT_NONE,
  TradeRoute,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  ONE,
  parseSaveGame,
  playerCommand,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../../src/index.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassCellMap as grassMap, waterColumnMap } from '../../fixtures/terrain.js';

/**
 * A trader's own storehouse stop set to its whole settlement loads out of the storehouse first, then
 * out of the storehouses and producing workshops its goods search reaches, and keeps a reserve summed
 * over them; what the route brings back still goes into the storehouse. An agreement's limits keep the
 * give good back at home and stop new batches once home holds enough of the take good.
 */

const VIKING = 1;
const HUMAN = 0;
const NEIGHBOUR = 1;
const TRADER = 25;
const HANDCART = 1;
const WOOD = 1;
const PLANK = 2;
const HEADQUARTERS = 1;
const SAWMILL = 2;
const TRADING_POST_ID = 700;
/** The settlement's storehouse, a second house of it, and the route's other stop, left to right. */
const ANCHOR_X = 1;
const MEMBER_X = 4;
const OTHER_X = 7;
/** Further than the goods search reaches from the anchor's door (40 nodes, 20 cells). */
const OUT_OF_REACH_X = 26;
const MAP_W = 30;
/** A water column that cuts the settlement house past it off from the cart. */
const WATER_X = OUT_OF_REACH_X - 2;
const MAP_H = 3;
const RUN_TICKS = 2000;
const WOOD_HELD = 6;
const WOOD_KEPT = 5;
/** The agreement's planks once home holds them, two per wood. */
const PLANKS_WANTED = 4;

function newSim(map = grassMap(MAP_W, MAP_H)): Simulation {
  const sim = new Simulation({ seed: 3, content: testContent(), map });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  return sim;
}

function houseAt(
  sim: Simulation,
  x: number,
  stock: Array<[number, number]> = [],
  options: { owner?: number; type?: number; missionId?: number } = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(1) });
  sim.world.add(e, Building, {
    buildingType: options.type ?? HEADQUARTERS,
    tribe: VIKING,
    built: ONE,
    level: 0,
  });
  sim.world.add(e, Stockpile, { amounts: new Map(stock) });
  sim.world.add(e, Owner, { player: options.owner ?? HUMAN });
  if (options.missionId !== undefined) sim.world.add(e, MissionObjectId, { id: options.missionId });
  return e;
}

/** A trader at `x` handed a handcart standing beside it. */
function traderAt(sim: Simulation, x: number): Entity {
  const trader = sim.world.create();
  sim.world.add(trader, Position, { x: fx.fromInt(x), y: fx.fromInt(1) });
  addPerson(sim.world, trader, {
    tribe: VIKING,
    jobType: TRADER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(trader, Owner, { player: HUMAN });
  const cart = createVehicle(sim.world, ctxOf(sim), {
    vehicleType: HANDCART,
    x: 2 * x,
    y: 0,
    tribe: VIKING,
    owner: HUMAN,
  });
  if (cart === null) throw new Error('handcart not in the fixture');
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
  return trader;
}

function stockOf(sim: Simulation, house: Entity, good: number): number {
  return sim.world.get(house, Stockpile).amounts.get(good) ?? 0;
}

function route(sim: Simulation, trader: Entity, first: Entity, second: Entity): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house: first }));
  sim.enqueue(playerCommand(HUMAN, { kind: 'attachTradeHouse', entity: trader, house: second }));
}

function settle(sim: Simulation, trader: Entity, house: Entity, on = true): void {
  sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeSettlement', entity: trader, house, on }));
}

/** Carry wood into `into`, keeping `keep` back at the other stop. */
function woodInto(sim: Simulation, trader: Entity, into: Entity, upTo = TRADE_LIMIT_NONE, keep = 0): void {
  sim.enqueue(
    playerCommand(HUMAN, { kind: 'setTradeImport', entity: trader, house: into, good: WOOD, on: true }),
  );
  sim.enqueue(
    playerCommand(HUMAN, {
      kind: 'setTradeImportLimits',
      entity: trader,
      house: into,
      good: WOOD,
      upTo,
      keep,
    }),
  );
}

describe('a settlement stop between own houses', () => {
  it('loads out of the other storehouses of its settlement, and only once set to it', () => {
    for (const settled of [false, true]) {
      const sim = newSim();
      const anchor = houseAt(sim, ANCHOR_X);
      const member = houseAt(sim, MEMBER_X, [[WOOD, WOOD_HELD]]);
      const other = houseAt(sim, OTHER_X);
      const trader = traderAt(sim, ANCHOR_X);
      route(sim, trader, anchor, other);
      woodInto(sim, trader, other);
      if (settled) settle(sim, trader, anchor);

      sim.run(RUN_TICKS);

      expect(stockOf(sim, other, WOOD)).toBe(settled ? WOOD_HELD : 0);
      expect(stockOf(sim, member, WOOD)).toBe(settled ? 0 : WOOD_HELD);
    }
  });

  it('takes from its own storehouse first', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X, [[WOOD, 3]]);
    const member = houseAt(sim, MEMBER_X, [[WOOD, 3]]);
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other, 3);
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, WOOD)).toBe(3);
    expect(stockOf(sim, anchor, WOOD)).toBe(0);
    expect(stockOf(sim, member, WOOD)).toBe(3);
  });

  it('empties the settlement house it stands at before turning back for a unit dropped at home', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X);
    const member = houseAt(sim, MEMBER_X, [[WOOD, WOOD_HELD]]);
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other);
    settle(sim, trader, anchor);
    let ticks = 0;
    while (stockOf(sim, member, WOOD) === WOOD_HELD && ticks++ < RUN_TICKS) sim.step();
    setStockAmount(sim.world, anchor, WOOD, 1);
    while (stockOf(sim, member, WOOD) > 0 && ticks++ < RUN_TICKS) sim.step();

    expect(stockOf(sim, member, WOOD)).toBe(0);
    expect(stockOf(sim, anchor, WOOD)).toBe(1);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, WOOD)).toBe(WOOD_HELD + 1);
  });

  it('keeps the reserve summed over the settlement', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X, [[WOOD, 2]]);
    const member = houseAt(sim, MEMBER_X, [[WOOD, WOOD_HELD]]);
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other, TRADE_LIMIT_NONE, WOOD_KEPT);
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, anchor, WOOD) + stockOf(sim, member, WOOD)).toBe(WOOD_KEPT);
    expect(stockOf(sim, other, WOOD)).toBe(2 + WOOD_HELD - WOOD_KEPT);
  });

  it('counts a storage minimum’s surplus once across the settlement’s storehouses', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X, [[WOOD, WOOD_HELD]]);
    const member = houseAt(sim, MEMBER_X, [[WOOD, WOOD_HELD]]);
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    // The two storehouses spare WOOD_KEPT - 1 units between them, each alone up to that many.
    const minimum = 2 * WOOD_HELD - (WOOD_KEPT - 1);
    sim.enqueueSetup({ kind: 'setStorageMinimum', player: HUMAN, goodType: WOOD, amount: minimum });
    woodInto(sim, trader, other, TRADE_LIMIT_NONE, WOOD_KEPT);
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, WOOD)).toBe(0);
    expect(stockOf(sim, anchor, WOOD) + stockOf(sim, member, WOOD)).toBe(2 * WOOD_HELD);
  });

  it('never loads out of the stop it carries into', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X);
    const other = houseAt(sim, OTHER_X, [[WOOD, WOOD_HELD]]);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other);
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, WOOD)).toBe(WOOD_HELD);
    expect(stockOf(sim, anchor, WOOD)).toBe(0);
  });

  it("loads a workshop's output, never its input", () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X);
    const sawmill = houseAt(
      sim,
      MEMBER_X,
      [
        [WOOD, WOOD_HELD],
        [PLANK, WOOD_HELD],
      ],
      { type: SAWMILL },
    );
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other);
    sim.enqueue(
      playerCommand(HUMAN, { kind: 'setTradeImport', entity: trader, house: other, good: PLANK, on: true }),
    );
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, other, PLANK)).toBe(WOOD_HELD);
    expect(stockOf(sim, sawmill, WOOD)).toBe(WOOD_HELD);
  });

  it('reaches as far as its goods search under signpost navigation, everywhere without it', () => {
    for (const navigation of [true, false]) {
      const sim = newSim();
      sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: navigation });
      const anchor = houseAt(sim, ANCHOR_X);
      const far = houseAt(sim, OUT_OF_REACH_X, [[WOOD, WOOD_HELD]]);
      const other = houseAt(sim, OTHER_X);
      const trader = traderAt(sim, ANCHOR_X);
      route(sim, trader, anchor, other);
      woodInto(sim, trader, other);
      settle(sim, trader, anchor);

      sim.run(2 * RUN_TICKS);

      expect(stockOf(sim, far, WOOD)).toBe(navigation ? WOOD_HELD : 0);
    }
  });

  it('keeps its cart and loads elsewhere when it cannot reach a settlement house', () => {
    const sim = newSim(waterColumnMap(MAP_W, MAP_H, WATER_X));
    const anchor = houseAt(sim, ANCHOR_X);
    const member = houseAt(sim, MEMBER_X, [[WOOD, 3]]);
    const island = houseAt(sim, OUT_OF_REACH_X, [[WOOD, 3]]);
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, anchor, other);
    woodInto(sim, trader, other);
    settle(sim, trader, anchor);

    sim.run(2 * RUN_TICKS);

    expect(stockOf(sim, member, WOOD)).toBe(0);
    expect(stockOf(sim, other, WOOD)).toBe(3);
    expect(stockOf(sim, island, WOOD)).toBe(3);
    expect(sim.world.has(trader, HaulingCart)).toBe(true);
  });

  it('is set on an own storehouse alone, on one stop at a time, and shown on the trader view', () => {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X);
    const sawmill = houseAt(sim, MEMBER_X, [], { type: SAWMILL });
    const other = houseAt(sim, OTHER_X);
    const trader = traderAt(sim, ANCHOR_X);
    route(sim, trader, sawmill, other);
    settle(sim, trader, sawmill);
    sim.step();
    expect(sim.world.get(trader, TradeRoute).stops.map((stop) => stop.settlement)).toEqual([false, false]);

    route(sim, trader, anchor, other);
    settle(sim, trader, anchor);
    settle(sim, trader, other);
    sim.step();

    const view = sim.traderView(trader);
    expect(view?.stops.map((stop) => [stop.house, stop.settlement, stop.settles])).toEqual([
      [anchor, true, true],
      [other, false, true],
    ]);
  });
});

describe('a settlement stop before a foreign trip', () => {
  function tradingWorld(home: Array<[number, number]>, member: Array<[number, number]>) {
    const sim = newSim();
    const anchor = houseAt(sim, ANCHOR_X, home);
    const neighbour = houseAt(sim, MEMBER_X, member);
    const post = houseAt(sim, OTHER_X, [[PLANK, 40]], { owner: NEIGHBOUR, missionId: TRADING_POST_ID });
    const trader = traderAt(sim, ANCHOR_X);
    sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN, to: NEIGHBOUR, state: 'friend' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: NEIGHBOUR, to: HUMAN, state: 'friend' });
    sim.enqueueSetup({
      kind: 'addTradeAgreement',
      missionId: TRADING_POST_ID,
      giveGood: WOOD,
      giveAmount: 1,
      takeGood: PLANK,
      takeAmount: 2,
    });
    route(sim, trader, anchor, post);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: 0 }));
    return { sim, anchor, neighbour, post, trader };
  }

  function limits(sim: Simulation, trader: Entity, giveKeep: number, takeUpTo: number): void {
    sim.enqueue(
      playerCommand(HUMAN, { kind: 'setTradeAgreementLimits', entity: trader, giveKeep, takeUpTo }),
    );
  }

  it('gives goods out of the whole settlement and brings what it takes to the storehouse', () => {
    const { sim, anchor, neighbour, post, trader } = tradingWorld([], [[WOOD, 3]]);
    settle(sim, trader, anchor);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, post, WOOD)).toBe(3);
    expect(stockOf(sim, anchor, PLANK)).toBe(6);
    expect(stockOf(sim, neighbour, PLANK)).toBe(0);
  });

  it('keeps the give good back at home', () => {
    const { sim, anchor, neighbour, post, trader } = tradingWorld([[WOOD, 2]], [[WOOD, WOOD_HELD]]);
    settle(sim, trader, anchor);
    limits(sim, trader, WOOD_KEPT, TRADE_LIMIT_NONE);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, anchor, WOOD) + stockOf(sim, neighbour, WOOD)).toBe(WOOD_KEPT);
    expect(stockOf(sim, post, WOOD)).toBe(2 + WOOD_HELD - WOOD_KEPT);
  });

  it('starts no batch once home holds the take good it is filled up to', () => {
    const { sim, anchor, post, trader } = tradingWorld([[WOOD, WOOD_HELD]], []);
    limits(sim, trader, TRADE_LIMIT_NONE, PLANKS_WANTED);

    sim.run(RUN_TICKS);

    expect(stockOf(sim, anchor, PLANK)).toBe(PLANKS_WANTED);
    expect(stockOf(sim, post, WOOD)).toBe(PLANKS_WANTED / 2);
    expect(sim.traderView(trader)).toMatchObject({ giveKeep: TRADE_LIMIT_NONE, takeUpTo: PLANKS_WANTED });
  });

  it('drops the limits with the agreement, and takes none without one', () => {
    const { sim, trader } = tradingWorld([], []);
    limits(sim, trader, WOOD_KEPT, PLANKS_WANTED);
    sim.enqueue(playerCommand(HUMAN, { kind: 'setTradeAgreement', entity: trader, agreement: -1 }));
    limits(sim, trader, WOOD_KEPT, PLANKS_WANTED);
    sim.step();

    expect(sim.world.get(trader, TradeRoute)).toMatchObject({
      agreement: -1,
      giveKeep: TRADE_LIMIT_NONE,
      takeUpTo: TRADE_LIMIT_NONE,
    });
  });

  it('carries the settlement and limits through a save and back', () => {
    const { sim, anchor, trader } = tradingWorld([[WOOD, 2]], [[WOOD, WOOD_HELD]]);
    settle(sim, trader, anchor);
    limits(sim, trader, 1, PLANKS_WANTED);
    sim.run(RUN_TICKS / 4);

    const saved = serializeSaveGame(exportSaveGame(sim));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(saved)), {
      content: testContent(),
      map: grassMap(MAP_W, MAP_H),
    });
    expect(restored.hashState()).toBe(sim.hashState());
    expect(serializeSaveGame(exportSaveGame(restored))).toBe(saved);
  });
});
