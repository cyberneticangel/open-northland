import { formatMessage, messages } from '../../../i18n/index.js';
import type { BuildingPanelModel } from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import { button, element, setAttribute, setClass, setHidden, setTip, write } from '../parts/dom.js';
import type { BuildingPanelDeps } from './actions.js';

export interface AlarmSection {
  readonly element: HTMLElement;
  update(model: BuildingPanelModel): void;
  /** Toggle this house's alarm as a click would; false when the shown building has none. */
  press(): boolean;
}

/** The alarm row of a house that shelters civilians, in the order tiles' look: a wide labelled toggle
 *  for this house and beside it a small one that sends every shelter of the owner the same way, as the
 *  defence keys do. Both follow this house's state. */
export function createAlarmSection(
  deps: BuildingPanelDeps,
  current: () => BuildingPanelModel | null,
): AlarmSection {
  const bar = element('div', 'on-alarm-bar');
  const here = button('on-order on-order--tile on-alarm', `${GLYPH.trumpet}<span></span>`);
  const everywhere = button(
    'on-order on-order--tile on-alarm on-alarm--everywhere',
    `${GLYPH.settlement}<span></span>`,
  );
  const hereLabel = here.lastElementChild;
  const everywhereLabel = everywhere.lastElementChild;
  if (!(hereLabel instanceof HTMLElement) || !(everywhereLabel instanceof HTMLElement)) {
    throw new Error('building alarm: labels');
  }
  const press = (all: boolean): boolean => {
    const shown = current();
    const alarm = shown?.orders?.alarm;
    if (shown === null || alarm == null) return false;
    if (all) deps.building.setAlarmEverywhere(shown.entityId, !alarm.on);
    else deps.building.setAlarm(shown.entityId, !alarm.on);
    return true;
  };
  here.addEventListener('click', () => press(false));
  everywhere.addEventListener('click', () => press(true));
  bar.append(here, everywhere);

  return {
    element: bar,
    press: () => press(false),
    update(model): void {
      const alarm = model.orders?.alarm ?? null;
      setHidden(bar, alarm === null);
      if (alarm === null) return;
      const copy = messages().hud.buildingPanel;
      const label = alarm.on ? copy.orders.alarmOff : copy.orders.alarmOn;
      write(hereLabel, label);
      const words = alarm.on ? copy.alarmOffTooltip : copy.alarmOnTooltip;
      setTip(here, `${words} · ${deps.keyLabel('buildingAlarm')}`);
      setAttribute(here, 'aria-label', label);
      setAttribute(here, 'aria-pressed', String(alarm.on));
      setClass(here, 'on-alarm--on', alarm.on);
      const tip = formatMessage(alarm.on ? copy.alarmOffEverywhereTooltip : copy.alarmOnEverywhereTooltip, {
        key: deps.keyLabel(alarm.on ? 'defenceOff' : 'defenceOn'),
      });
      write(everywhereLabel, copy.orders.alarmEverywhere);
      setTip(everywhere, tip);
      setAttribute(everywhere, 'aria-label', tip);
    },
  };
}
