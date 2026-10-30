import type { Entity, Simulation, VehicleView } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { playerSwatchHex } from '../../../src/catalog/roster.js';
import { HUMAN_PLAYER } from '../../../src/game/rules.js';
import { VEHICLE_HANDCART, VEHICLE_OXCART, VEHICLE_SHIP_SMALL } from '../../../src/game/sandbox/index.js';
import { fixedViewerSeat } from '../../../src/game/viewer-seat.js';
import { type VehicleHoverContext, vehicleHoverModel } from '../../../src/hud/hover-card/vehicle.js';
import { messages } from '../../../src/i18n/index.js';
import { tradeDomesticScene } from '../../../src/scenes/economy/trade-domestic.js';
import { createSceneSim } from '../../../src/scenes/index.js';
import { vehiclesScene } from '../../../src/scenes/vehicles/vehicles.js';
import { ctxOf } from '../../support/sandbox.js';

/** Another seat than the viewer's. */
const OTHER_PLAYER = HUMAN_PLAYER + 1;

/** The scene `ticks` in, read by `viewer` at war with everyone, the trader seam wired. */
function world(
  scene: typeof vehiclesScene,
  ticks = 1,
  viewer = HUMAN_PLAYER,
): { sim: Simulation; ctx: VehicleHoverContext } {
  const sim = createSceneSim(scene);
  for (let i = 0; i < ticks; i++) sim.step();
  return {
    sim,
    ctx: {
      ...ctxOf(sim),
      viewer: fixedViewerSeat(viewer),
      diplomacyStance: () => 'enemy',
      traderView: (entity) => sim.traderView(entity as Entity),
    },
  };
}

function ownVehicle(sim: Simulation, type: number): VehicleView {
  const view = sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === type);
  if (view === undefined) throw new Error(`no own vehicle of type ${type}`);
  return view;
}

const panel = () => messages().hud.vehiclePanel;

describe('vehicle hover card model', () => {
  it('names the commander of a crewed cart, by name and trade', () => {
    const { sim, ctx } = world(vehiclesScene);
    const cart = ownVehicle(sim, VEHICLE_HANDCART);

    const model = vehicleHoverModel(sim.snapshot(), cart.entity, ctx);

    expect(model?.title).toBe(messages().goods.handcart);
    expect(model?.owner).toBeNull();
    expect(model?.health?.hover).toBe(`${cart.hitpoints}/${cart.maxHitpoints}`);
    const commander = model?.facts[0];
    expect(commander?.label).toBe(panel().roles.cart);
    expect(commander?.value).toMatch(/ · Tragarz/);
  });

  it('says a driverless cart has nobody, cannot move, and lists what it carries', () => {
    const { sim, ctx } = world(vehiclesScene);
    const cart = ownVehicle(sim, VEHICLE_OXCART);

    const model = vehicleHoverModel(sim.snapshot(), cart.entity, ctx);

    expect(model?.facts).toEqual([{ label: panel().roles.cart, value: messages().hud.hoverCard.nobody }]);
    expect(model?.status).toEqual({ label: panel().status.noCommander.cart, trouble: true });
    expect(model?.rows).toEqual([{ goodId: 'wood', label: 'Drewno', amount: 8 }]);
  });

  it("counts a ship's taken seats", () => {
    const { sim, ctx } = world(vehiclesScene);
    const ship = ownVehicle(sim, VEHICLE_SHIP_SMALL);

    const model = vehicleHoverModel(sim.snapshot(), ship.entity, ctx);

    expect(model?.facts).toContainEqual({
      label: panel().crew,
      value: `${ship.passengers.length} / ${ship.passengerCapacity}`,
    });
  });

  it("follows the trader's route from the stop it left to the one it heads for", () => {
    const { sim, ctx } = world(tradeDomesticScene, 2);
    const cart = ownVehicle(sim, VEHICLE_HANDCART);

    const route = vehicleHoverModel(sim.snapshot(), cart.entity, ctx)?.facts.find(
      (fact) => fact.label === messages().hud.hoverCard.route,
    );

    expect(route?.value).toMatch(/^Magazyn.* → Magazyn/);
  });

  it("names another seat's owner and commander, and keeps its hold and route to itself", () => {
    const { sim, ctx } = world(vehiclesScene, 1, OTHER_PLAYER);
    const oxcart = ownVehicle(sim, VEHICLE_OXCART);
    const handcart = ownVehicle(sim, VEHICLE_HANDCART);

    const loaded = vehicleHoverModel(sim.snapshot(), oxcart.entity, ctx);
    const crewed = vehicleHoverModel(sim.snapshot(), handcart.entity, ctx);

    expect(loaded?.owner).toEqual({
      player: HUMAN_PLAYER,
      stance: 'enemy',
      colour: playerSwatchHex(HUMAN_PLAYER),
    });
    expect(loaded?.rows).toEqual([]);
    expect(crewed?.facts.map((fact) => fact.label)).toEqual([panel().roles.cart]);
  });

  it("keeps another seat's trader route to itself", () => {
    const { sim, ctx } = world(tradeDomesticScene, 2, OTHER_PLAYER);
    const cart = ownVehicle(sim, VEHICLE_HANDCART);

    const labels = vehicleHoverModel(sim.snapshot(), cart.entity, ctx)?.facts.map((fact) => fact.label);

    expect(labels).toEqual([panel().roles.cart]);
  });

  it('has nothing to say about anything but a vehicle', () => {
    const { sim, ctx } = world(vehiclesScene);
    const cart = ownVehicle(sim, VEHICLE_HANDCART);

    expect(vehicleHoverModel(sim.snapshot(), cart.commander ?? -1, ctx)).toBeNull();
    expect(vehicleHoverModel(sim.snapshot(), -1, ctx)).toBeNull();
  });
});
