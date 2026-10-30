import { components, playerCommand } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { JOB_TRADER } from '../../../src/catalog/jobs.js';
import { spawnSettlerDirect, VEHICLE_OXCART } from '../../../src/game/sandbox/index.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';
import { vehicleOxScene } from '../../../src/scenes/vehicles/vehicle-ox.js';
import { sceneAcceptance } from '../scene-case.js';

sceneAcceptance(vehicleOxScene, import.meta.url);

it('refuses a trader until the cow arrives, then hands the same trader the cart to pull', () => {
  const sim = createSceneSim(vehicleOxScene);
  const { HaulingCart, Position, Rider, Vehicle, VehicleDrive } = components;
  const trader = spawnSettlerDirect(sim, JOB_TRADER, 7, 7);
  const [cart] = sim.world.query(Vehicle);
  if (cart === undefined) throw new Error('missing cart');
  const position = { ...sim.world.get(cart, Position) };
  const attach = playerCommand(0, { kind: 'attachToVehicle', entity: trader, vehicle: cart });
  expect(sim.canAttachToVehicle(trader, cart)).toBe(false);
  sim.enqueue(attach);
  sim.enqueue(playerCommand(0, { kind: 'moveVehicle', vehicle: cart, x: 24, y: 20 }));
  sim.step();
  expect(sim.events.current()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'riderRefused', entity: trader, reason: 'cannotEnter' }),
      expect.objectContaining({ kind: 'vehicleMoveRefused', entity: cart, reason: 'noAnimal' }),
    ]),
  );
  expect(sim.world.has(trader, Rider)).toBe(false);
  expect(sim.world.has(cart, VehicleDrive)).toBe(false);
  expect(sim.world.get(cart, Position)).toEqual(position);
  while (sim.tick < vehicleOxScene.runTicks && !sim.world.get(cart, Vehicle).harnessed) sim.step();
  expect(sim.world.get(cart, Vehicle).vehicleType).toBe(VEHICLE_OXCART);
  expect(sim.canAttachToVehicle(trader, cart)).toBe(true);
  sim.enqueue(attach);
  sim.step();
  expect(sim.world.get(trader, HaulingCart).vehicle).toBe(cart);
});
