import { components, playerCommand, type Simulation, TICKS_PER_SECOND } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_TRADER } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_BAKERY,
  BUILDING_HOME_00,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_HANDCART,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';
import { tradeDomesticGood, tradeDomesticHouses, tradeDomesticStock } from './trade-domestic.js';

/**
 * A trader between a bakery and a home, bread marked into the home: the home keeps no bread, only food,
 * and the cart carries the loaves as the food it stores. The browser view is the trade window, where
 * the bakery's bread arrow into the home is open.
 */

const MAP_W = 24;
const MAP_H = 12;
const BAKERY_AT = { x: 5, y: 5 } as const;
const HOME_AT = { x: 17, y: 5 } as const;
const TRADER_AT = { x: 6, y: 8 } as const;
const CART_AT = { x: 7, y: 8 } as const;
const LOAVES = 8;
/** Long enough for the cart's first trip to unload in the home. */
const RUN_TICKS = TICKS_PER_SECOND * 60;

const { setStockAmount } = components;

function build(sim: Simulation): void {
  const bakery = placeBuiltSandboxBuilding(sim, BUILDING_BAKERY, BAKERY_AT.x, BAKERY_AT.y, HUMAN_PLAYER);
  const home = placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, HOME_AT.x, HOME_AT.y, HUMAN_PLAYER);
  const bread = tradeDomesticGood(sim, 'bread');
  if (bread === undefined) return;
  setStockAmount(sim.world, bakery, bread, LOAVES);
  const trader = spawnSettlerDirect(sim, JOB_TRADER, TRADER_AT.x, TRADER_AT.y, HUMAN_PLAYER);
  const cart = spawnVehicleDirect(sim, VEHICLE_HANDCART, CART_AT.x, CART_AT.y);
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: bakery }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: home }));
  sim.enqueue(
    playerCommand(HUMAN_PLAYER, {
      kind: 'setTradeImport',
      entity: trader,
      house: home,
      good: bread,
      on: true,
    }),
  );
}

export const tradeBreadScene: SceneDefinition = {
  id: 'trade-bread',
  seed: 45,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the bakery hands bread over and the home takes it in as food',
      predicate: (sim) => {
        const houses = tradeDomesticHouses(sim);
        const bread = tradeDomesticGood(sim, 'bread');
        const food = tradeDomesticGood(sim, 'food_simple');
        if (houses === undefined || bread === undefined || food === undefined) return false;
        return (
          tradeDomesticStock(sim, houses.a, bread) < LOAVES &&
          tradeDomesticStock(sim, houses.b, food) > 0 &&
          tradeDomesticStock(sim, houses.b, bread) === 0
        );
      },
    },
  ],
};
