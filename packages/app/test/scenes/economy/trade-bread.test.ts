import type { Entity } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { tradePanelModel } from '../../../src/hud/details-panel/model/trade.js';
import { transferLine } from '../../../src/hud/dom/trade-window/model.js';
import { sceneTrader } from '../../../src/scenes/economy/trade.js';
import { tradeBreadScene } from '../../../src/scenes/economy/trade-bread.js';
import { tradeDomesticGood } from '../../../src/scenes/economy/trade-domestic.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';
import { ctxOf } from '../../support/sandbox.js';
import { sceneAcceptance } from '../scene-case.js';

sceneAcceptance(tradeBreadScene, import.meta.url);

it("opens the bakery's bread arrow into a home that keeps only food", () => {
  const sim = createSceneSim(tradeBreadScene);
  sim.run(1);
  const trader = sceneTrader(sim);
  const bread = tradeDomesticGood(sim, 'bread');
  const ctx = { ...ctxOf(sim), traderView: (entity: number) => sim.traderView(entity as Entity) };
  const trade = trader === undefined ? null : tradePanelModel(ctx, sim.snapshot(), trader);
  if (trade === null || bread === undefined) throw new Error('expected the trader on its two-house route');
  const [transfer] = trade.transfers;
  if (transfer === undefined) throw new Error('expected the bread transfer');
  expect(transfer.goodType).toBe(bread);
  expect(transferLine(trade, transfer).directions.toB.enabled).toBe(true);
});
