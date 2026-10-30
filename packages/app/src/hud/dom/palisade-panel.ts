import { formatMessage, messages } from '../../i18n/index.js';
import type { PalisadePanelModel, UnitPanelModel } from '../details-panel/model/index.js';
import { GLYPH } from './icons.js';
import {
  button,
  element,
  isDisabled,
  setAttribute,
  setDisabled,
  setHidden,
  setTip,
  write,
} from './parts/dom.js';
import { createMeterRow } from './parts/meter-row.js';
import { createSection } from './parts/section.js';
import { createSwitch } from './parts/switch.js';
import type { TipChip } from './parts/tip-layer.js';
import { createSelectionPanel } from './selection-panel.js';

type GateMode = 'open' | 'closed' | 'automatic';

/** The order the toggle names: the opposite of a manual mode, or of the passage under automatic. */
function gateToggleTarget(mode: GateMode, passageOpen: boolean): 'open' | 'closed' {
  const open = mode === 'automatic' ? passageOpen : mode === 'open';
  return open ? 'closed' : 'open';
}

/** A wall segment, a gate or a road site: its state, health and the one order that removes it. Only a
 *  gate has a passage and a mode to set. */
export function createPalisadePanel(deps: {
  readonly plane: HTMLElement;
  readonly tooltip: TipChip;
  readonly close: () => void;
  readonly mode: (id: number, mode: GateMode) => void;
  readonly demolish: (id: number) => void;
  readonly cancelRoadSite: (id: number) => void;
}) {
  let shown: PalisadePanelModel | null = null;
  const frame = createSelectionPanel(
    deps.plane,
    {
      onBrowse: () => {},
      onOrders: () => {},
      onKickerDoubleClick: () => {},
      onRename: () => {},
      onClose: deps.close,
    },
    deps.tooltip,
  );
  frame.element.classList.add('on-palisade-panel');
  const summary = element('div', 'on-palisade-panel__summary');
  const art = element('span', 'on-palisade-panel__art');
  const state = element('strong', 'on-palisade-panel__state');
  state.setAttribute('role', 'status');
  const health = createMeterRow();
  const order = (pick: (mode: GateMode, passageOpen: boolean) => GateMode): void => {
    if (shown === null || shown.foreign || shown.underConstruction || shown.gateMode === null) return;
    deps.mode(shown.entityId, pick(shown.gateMode, shown.gateOpen === true));
  };
  const controls = element('div', 'on-palisade-panel__controls');
  const toggle = button('on-button on-button--rounded on-palisade-panel__toggle');
  toggle.addEventListener('click', () => {
    if (!isDisabled(toggle)) order(gateToggleTarget);
  });
  // Leaving automatic keeps the passage as it stands, so the switch alone never moves the gate.
  const automatic = createSwitch('', '', (on) =>
    order((_, passageOpen) => (on ? 'automatic' : passageOpen ? 'open' : 'closed')),
  );
  const automaticLabel = element('span', 'on-palisade-panel__auto-label');
  const automaticRow = element('label', 'on-palisade-panel__auto');
  automaticRow.append(automaticLabel, automatic.element);
  const section = createSection(automaticRow);
  controls.append(toggle);
  const hint = element('p', 'on-palisade-panel__hint');
  const remove = button('on-medallion on-palisade-panel__remove', GLYPH.demolish);
  remove.addEventListener('click', () => {
    if (shown === null || shown.foreign) return;
    if (shown.roadSite) deps.cancelRoadSite(shown.entityId);
    else deps.demolish(shown.entityId);
  });
  summary.append(art, state, remove);
  frame.body.append(summary, health.element, section.element, controls, hint);
  let glyph = '';
  const showGlyph = (next: string): void => {
    if (next === glyph) return;
    glyph = next;
    art.innerHTML = next;
  };
  return {
    update(model: UnitPanelModel): void {
      if (model.kind !== 'palisade') {
        shown = null;
        frame.hide();
        return;
      }
      shown = model;
      const hud = messages().hud;
      const copy = hud.palisadePanel;
      const gate = model.gateOpen !== null;
      frame.updateHead({
        kicker: '',
        title: model.roadSite ? hud.roadSite : gate ? hud.gate : hud.palisade,
        browse: null,
        rename: null,
        meta: null,
        orders: null,
        labels: { close: hud.settlerPanel.close, prev: hud.settlerPanel.prev, next: hud.settlerPanel.next },
      });
      showGlyph(model.roadSite ? GLYPH.road : gate ? GLYPH.gate : GLYPH.palisade);
      setAttribute(art, 'data-open', String(model.gateOpen === true));
      const progress = formatMessage(hud.constructionProgress, { percent: model.builtPct });
      write(
        state,
        model.roadSite
          ? (model.siteStatus ?? progress)
          : gate
            ? model.gateOpen
              ? copy.passageOpen
              : copy.passageClosed
            : model.underConstruction
              ? progress
              : copy.finished,
      );
      setHidden(health.element, model.health === null);
      if (model.health !== null) health.update({ ...model.health, tooltip: model.health.hover });
      setHidden(section.element, !gate);
      setHidden(controls, !gate);
      if (gate && model.gateMode !== null) {
        section.update(copy.mode);
        const enabled = !model.foreign && !model.underConstruction;
        const auto = model.gateMode === 'automatic';
        const target = gateToggleTarget(model.gateMode, model.gateOpen === true);
        write(toggle, target === 'open' ? copy.open : copy.close);
        setDisabled(toggle, !enabled || auto);
        setTip(toggle, auto ? copy.manualLocked : '');
        write(automaticLabel, copy.automatic);
        setAttribute(automatic.element, 'aria-label', copy.automatic);
        setTip(automatic.element, copy.automaticTip);
        automatic.update(auto, enabled);
      }
      const status =
        gate && model.underConstruction
          ? progress
          : model.gateMode === 'closed' && model.gateOpen === true
            ? copy.waiting
            : '';
      write(hint, status);
      setHidden(hint, status === '');
      const removeLabel = model.roadSite
        ? hud.cancelRoadSite
        : gate
          ? hud.demolishGate
          : hud.demolishPalisade;
      setAttribute(remove, 'aria-label', removeLabel);
      setTip(remove, removeLabel);
      setHidden(remove, model.foreign);
      frame.show();
    },
    claims: frame.claims,
    refreshTip: frame.refreshTip,
    dispose: frame.dispose,
  };
}
