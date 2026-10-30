import { components, type Entity, ONE, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../../../src/game/rules.js';
import { BUILDING_HOME_00, sandboxContent } from '../../../../src/game/sandbox/index.js';
import { type TradeStances, tradeRefusal } from '../../../../src/view/unit-controls/orders/trade-refusal.js';

const NEIGHBOUR = HUMAN_PLAYER + 1;
const TRADES = true;
const TRADES_NOT = false;

function houseOf(sim: Simulation, player: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, components.Position, { x: ONE, y: ONE });
  sim.world.add(e, components.Building, {
    buildingType: BUILDING_HOME_00,
    tribe: PRIMARY_TRIBE,
    built: ONE,
    level: 0,
  });
  sim.world.add(e, components.Owner, { player });
  return e;
}

const stances = (yours: TradeStances['yours'], theirs: TradeStances['theirs']) => (): TradeStances => ({
  yours,
  theirs,
});

describe('a refused trade stop', () => {
  it('names the tribe whose house the stances keep off the route', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const post = houseOf(sim, NEIGHBOUR);

    const refusal = tradeRefusal(sim.snapshot(), post, HUMAN_PLAYER, TRADES, stances('friend', 'enemy'));

    expect(refusal?.owner).toBe(NEIGHBOUR);
    expect(refusal?.at).not.toBeNull();
  });

  it('stays silent for a foreign house that would trade with nobody, a barracks or a site alike', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const barracks = houseOf(sim, NEIGHBOUR);

    expect(
      tradeRefusal(sim.snapshot(), barracks, HUMAN_PLAYER, TRADES_NOT, stances('enemy', 'enemy')),
    ).toBeNull();
  });

  it('stays silent for an own house and for mutual friends', () => {
    const sim = new Simulation({ seed: 1, content: sandboxContent() });
    const own = houseOf(sim, HUMAN_PLAYER);
    const post = houseOf(sim, NEIGHBOUR);
    const snapshot = sim.snapshot();

    expect(tradeRefusal(snapshot, own, HUMAN_PLAYER, TRADES, stances('enemy', 'enemy'))).toBeNull();
    expect(tradeRefusal(snapshot, post, HUMAN_PLAYER, TRADES, stances('friend', 'friend'))).toBeNull();
  });
});
