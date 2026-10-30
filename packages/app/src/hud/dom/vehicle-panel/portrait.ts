import { formatMessage, messages } from '../../../i18n/index.js';
import {
  type HaulingCartHold,
  haulerStatusWords,
  type VehicleClass,
  type VehicleOrder,
  type VehicleOrderModel,
  type VehiclePanelModel,
  vehicleSubjectEntity,
} from '../../details-panel/model/index.js';
import { GLYPH } from '../icons.js';
import {
  button,
  element,
  setAttribute,
  setClass,
  setDisabled,
  setHidden,
  setStyleVar,
  setTip,
  write,
} from '../parts/dom.js';
import { meterFill, meterTone } from '../parts/meter-row.js';
import type { VehiclePanelDeps, VehiclePick } from './actions.js';

const ORDER_GLYPH: Readonly<Record<VehicleOrder, string>> = {
  goTo: GLYPH.pin,
  stop: GLYPH.stop,
  dock: GLYPH.anchor,
  boardShip: GLYPH.boardShip,
  leaveShip: GLYPH.leaveShip,
  attackSettler: GLYPH.swords,
  attackBuilding: GLYPH.siegeHouse,
  attackVehicle: GLYPH.wheel,
  attackPosition: GLYPH.crosshair,
};

type OrderCopy = ReturnType<typeof messages>['hud']['vehiclePanel']['orders'];

/** A ship's drive sails, every other vehicle's drives. */
function orderKey(order: VehicleOrder, vehicleClass: VehicleClass): keyof OrderCopy {
  return order === 'goTo' && vehicleClass === 'ship' ? 'sail' : order;
}

/** The order's name, and what its tooltip says: the refusal, the armed pick's prompt, or the name; the
 *  dock order also names its key (`dockKey`) and the Ctrl press that lands the crew. */
export function orderTexts(
  model: VehicleOrderModel,
  vehicleClass: VehicleClass,
  armed: boolean,
  dockKey: string,
): { label: string; tooltip: string } {
  const copy = messages().hud.vehiclePanel;
  const label = copy.orders[orderKey(model.order, vehicleClass)];
  if (model.control !== true) return { label, tooltip: model.control };
  if (model.order === 'dock') {
    const tooltip = armed ? copy.dockArmedTooltip : copy.dockTooltip;
    return { label, tooltip: formatMessage(tooltip, { order: label, key: dockKey }) };
  }
  return { label, tooltip: armed ? formatMessage(copy.armedTooltip, { order: label }) : label };
}

/** The status words around the carrier's name, which the strip shows as a link in their place. */
export function pulledByParts(hold: HaulingCartHold): { before: string; after: string } {
  const [before = '', after = ''] = haulerStatusWords(hold).split('{porter}');
  return { before, after };
}

/** The portrait block: the live vehicle's frame as the centre-view button with its wear under it, and
 *  beside it the order buttons with the status strip along the frame's floor. A taken hauling cart shows
 *  and centres on the carrier pulling it. */
export interface PortraitSection {
  readonly element: HTMLElement;
  /** The frame the renderer paints the live vehicle through. */
  readonly frame: HTMLElement;
  update(model: VehiclePanelModel): void;
  /** Once a frame: the button whose pick waits for its target lights. */
  refresh(armed: VehiclePick | null): void;
}

export function createPortraitSection(
  deps: VehiclePanelDeps,
  current: () => VehiclePanelModel | null,
): PortraitSection {
  const row = element('div', 'on-portrait');
  const shot = element('div', 'on-portrait-shot');
  const frame = button('on-portrait__frame');
  frame.addEventListener('click', () => {
    const shown = current();
    if (shown !== null) deps.actions.centre(vehicleSubjectEntity(shown));
  });
  const health = element('span', 'on-hp');
  health.setAttribute('role', 'meter');
  shot.append(frame, health);
  const beside = element('div', 'on-portrait__beside');
  const orders = element('div', 'on-orders');
  const status = element(
    'div',
    'on-status-strip',
    '<i class="on-status-strip__dot"></i><span><span></span></span>',
  );
  const text = status.querySelector('span > span');
  if (!(text instanceof HTMLElement)) throw new Error('vehicle portrait: status');
  // The carrying ship after a dot, or the carrier pulling a hauling cart inside the status words.
  const carrier = button('on-ledger__link');
  carrier.addEventListener('click', () => {
    const shown = current();
    const id = shown?.status.carrier?.id ?? shown?.hauler?.entity;
    if (id !== undefined) deps.actions.select(id);
  });
  const carrierJoint = document.createTextNode('');
  const carrierTail = document.createTextNode('');
  text.after(carrierJoint, carrier, carrierTail);
  beside.append(orders, status);
  row.append(shot, beside);

  let shape = '';
  let buttons: { order: VehicleOrder; element: HTMLButtonElement }[] = [];
  let armed: VehiclePick | null = null;
  const press = (order: VehicleOrder): void => {
    const shown = current();
    const model = [...(shown?.orders ?? []), ...(shown?.attackOrders ?? [])].find((o) => o.order === order);
    if (shown === null || model === undefined || model.control !== true) return;
    deps.vehicle.order(shown.entityId, order);
  };
  const build = (model: VehiclePanelModel): void => {
    const next = [...model.orders.map((o) => o.order), '|', ...model.attackOrders.map((o) => o.order)].join();
    if (next === shape) return;
    shape = next;
    const make = (order: VehicleOrder, attack: boolean, first: boolean): HTMLButtonElement => {
      const node = button(
        `on-order${attack ? ' on-order--attack' : ''}${first ? ' on-order--break' : ''}`,
        ORDER_GLYPH[order],
      );
      node.addEventListener('click', () => press(order));
      return node;
    };
    buttons = [
      ...model.orders.map((o) => ({ order: o.order, element: make(o.order, false, false) })),
      ...model.attackOrders.map((o, index) => ({
        order: o.order,
        element: make(o.order, true, index === 0),
      })),
    ];
    orders.replaceChildren(...buttons.map((b) => b.element));
  };
  const paintOrders = (model: VehiclePanelModel): void => {
    const all = [...model.orders, ...model.attackOrders];
    all.forEach((order, index) => {
      const node = buttons[index]?.element;
      if (node === undefined) return;
      const lit = armed === order.order;
      const texts = orderTexts(order, model.vehicleClass, lit, deps.keyLabel('dockShips'));
      setAttribute(node, 'aria-label', texts.label);
      setTip(node, texts.tooltip);
      setDisabled(node, order.control !== true);
      setClass(node, 'on-order--armed', lit);
      setAttribute(node, 'aria-pressed', String(lit));
    });
  };

  return {
    element: row,
    frame,
    update(model): void {
      const copy = messages().hud.vehiclePanel;
      setTip(frame, copy.centre);
      setAttribute(frame, 'aria-label', copy.centre);
      const hp = model.health;
      setHidden(health, hp === null);
      if (hp !== null) {
        const fill = meterFill(hp.hitpoints, hp.max);
        const tone = meterTone((hp.hitpoints / hp.max) * 100);
        setStyleVar(health, '--value', fill);
        setClass(health, 'on-hp--low', tone === 'low');
        setClass(health, 'on-hp--critical', tone === 'critical');
        const words = formatMessage(copy.health, { hitpoints: hp.hitpoints, max: hp.max });
        setTip(health, words);
        setAttribute(health, 'aria-label', words);
      }
      build(model);
      setHidden(orders, buttons.length === 0);
      paintOrders(model);
      setClass(status, 'on-status-strip--trouble', model.status.tone === 'trouble');
      setClass(status, 'on-status-strip--neutral', model.status.tone === 'neutral');
      const ship = model.status.carrier;
      const hauler = ship === null ? model.hauler : null;
      setHidden(carrier, ship === null && hauler === null);
      if (ship !== null) {
        write(text, model.status.label);
        carrierJoint.textContent = ' · ';
        carrierTail.textContent = '';
        write(carrier, ship.label);
        setTip(carrier, copy.carrierTooltip);
      } else if (hauler !== null) {
        const { before, after } = pulledByParts(hauler.hold);
        write(text, before);
        carrierJoint.textContent = '';
        carrierTail.textContent = after;
        write(carrier, hauler.name);
        setTip(carrier, copy.haulerTooltip);
      } else {
        write(text, model.status.label);
        carrierJoint.textContent = '';
        carrierTail.textContent = '';
      }
    },
    refresh(next): void {
      const shown = current();
      if (next === armed || shown === null) return;
      armed = next;
      paintOrders(shown);
    },
  };
}
