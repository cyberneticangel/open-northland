// @vitest-environment jsdom

import { type EntitySnapshot, ONE } from '@open-northland/sim';
import { afterEach, expect, it, vi } from 'vitest';
import { createPalisadePanel } from '../../../src/hud/dom/palisade-panel.js';
import { formatMessage, messages } from '../../../src/i18n/index.js';
import { panelModelOf } from '../../support/details-panel.js';

const hud = messages().hud;
const HALF_BUILT = ONE / 2;
const HALF_BUILT_PCT = 50;
const VIEWER = 0;
const OTHER_SEAT = 1;

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function setup() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const plane = document.createElement('div');
  document.body.append(plane);
  const deps = {
    plane,
    tooltip: { show: () => {}, hide: () => {} },
    close: vi.fn(),
    mode: vi.fn(),
    demolish: vi.fn(),
    cancelRoadSite: vi.fn(),
  };
  const panel = createPalisadePanel(deps);
  const text = (selector: string): string => plane.querySelector(selector)?.textContent ?? '';
  const shown = (selector: string): boolean => plane.querySelector<HTMLElement>(selector)?.hidden === false;
  const remove = (): HTMLButtonElement => {
    const button = plane.querySelector<HTMLButtonElement>('.on-palisade-panel__remove');
    if (button === null) throw new Error('no remove medallion');
    return button;
  };
  return { plane, deps, panel, text, shown, remove };
}

const wall = (components: EntitySnapshot['components']): EntitySnapshot => ({
  id: 5,
  components: { Owner: { player: VIEWER }, Health: { hitpoints: 60, max: 100 }, ...components },
});

it('shows a finished wall segment with its health and demolishes it', () => {
  const h = setup();
  h.panel.update(panelModelOf(wall({ Palisade: { built: ONE, gate: null } })));
  expect(h.plane.textContent).toContain(hud.palisade);
  expect(h.text('.on-palisade-panel__state')).toBe(hud.palisadePanel.finished);
  expect(h.shown('.on-palisade-panel__controls')).toBe(false);
  expect(h.remove().getAttribute('aria-label')).toBe(hud.demolishPalisade);
  h.remove().click();
  expect(h.deps.demolish).toHaveBeenCalledWith(5);
});

it('names the build progress of a wall still under construction', () => {
  const h = setup();
  h.panel.update(panelModelOf(wall({ Palisade: { built: HALF_BUILT, gate: null }, UnderConstruction: {} })));
  expect(h.text('.on-palisade-panel__state')).toBe(
    formatMessage(hud.constructionProgress, { percent: HALF_BUILT_PCT }),
  );
});

it("offers no demolition on another seat's wall", () => {
  const h = setup();
  h.panel.update(panelModelOf(wall({ Palisade: { built: ONE, gate: null }, Owner: { player: OTHER_SEAT } })));
  expect(h.remove().hidden).toBe(true);
});

it('keeps automatic policy separate from an open passage on a gate', () => {
  const h = setup();
  const model = panelModelOf(
    wall({
      Palisade: { built: ONE, gate: { open: true, counterpartGfxIndex: 696 } },
      GateControl: { mode: 'automatic' },
    }),
  );
  expect(model).toMatchObject({ gateOpen: true, gateMode: 'automatic', foreign: false, health: { pct: 60 } });
  h.panel.update(model);
  expect(h.plane.textContent).toContain(hud.gate);
  expect(h.text('.on-palisade-panel__state')).toBe(hud.palisadePanel.passageOpen);
  expect(h.shown('.on-palisade-panel__controls')).toBe(true);
  expect(h.remove().getAttribute('aria-label')).toBe(hud.demolishGate);
});

it('withdraws a road site instead of demolishing it, and hides for any other selection', () => {
  const h = setup();
  h.panel.update({
    kind: 'palisade',
    entityId: 9,
    health: null,
    builtPct: 0,
    gateOpen: null,
    gateMode: null,
    foreign: false,
    underConstruction: true,
    roadSite: true,
    siteStatus: hud.roadSiteBuilderComing,
  });
  expect(h.plane.textContent).toContain(hud.roadSite);
  expect(h.text('.on-palisade-panel__state')).toBe(hud.roadSiteBuilderComing);
  h.remove().click();
  expect(h.deps.cancelRoadSite).toHaveBeenCalledWith(9);
  expect(h.deps.demolish).not.toHaveBeenCalled();
  h.panel.update({ kind: 'empty' });
  expect(h.plane.querySelector<HTMLElement>('.on-palisade-panel')?.hidden).toBe(true);
});

it('flips a manual gate with one button named after its order and hands it to the automatic switch', () => {
  const h = setup();
  const gate = (mode: 'open' | 'closed' | 'automatic', open: boolean) =>
    panelModelOf(
      wall({ Palisade: { built: ONE, gate: { open, counterpartGfxIndex: 696 } }, GateControl: { mode } }),
    );
  const toggle = h.plane.querySelector<HTMLButtonElement>('.on-palisade-panel__toggle');
  const automatic = h.plane.querySelector<HTMLButtonElement>('.on-palisade-panel__auto [role="switch"]');
  if (toggle === null || automatic === null) throw new Error('no gate controls');
  const copy = hud.palisadePanel;

  h.panel.update(gate('closed', false));
  expect(toggle.textContent).toBe(copy.open);
  toggle.click();
  expect(h.deps.mode).toHaveBeenLastCalledWith(5, 'open');
  h.panel.update(gate('open', true));
  expect(toggle.textContent).toBe(copy.close);
  toggle.click();
  expect(h.deps.mode).toHaveBeenLastCalledWith(5, 'closed');
  automatic.click();
  expect(h.deps.mode).toHaveBeenLastCalledWith(5, 'automatic');

  h.deps.mode.mockClear();
  h.panel.update(gate('automatic', true));
  expect(automatic.getAttribute('aria-checked')).toBe('true');
  expect(toggle.getAttribute('aria-disabled')).toBe('true');
  toggle.click();
  expect(h.deps.mode).not.toHaveBeenCalled();
  automatic.click();
  expect(h.deps.mode).toHaveBeenLastCalledWith(5, 'open');
  h.panel.update(gate('automatic', false));
  automatic.click();
  expect(h.deps.mode).toHaveBeenLastCalledWith(5, 'closed');

  h.deps.mode.mockClear();
  const foreign = gate('closed', false);
  if (foreign.kind !== 'palisade') throw new Error('not a gate panel');
  h.panel.update({ ...foreign, foreign: true });
  toggle.click();
  automatic.click();
  h.panel.update({ ...foreign, underConstruction: true });
  toggle.click();
  automatic.click();
  expect(h.deps.mode).not.toHaveBeenCalled();
});
