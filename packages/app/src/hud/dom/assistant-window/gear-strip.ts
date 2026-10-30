import { formatMessage, type messages } from '../../../i18n/index.js';
import { type GoodIconPainter, goodIconMarkup } from '../good-art.js';
import { button, element, setTip, write } from '../parts/dom.js';
import { type GearLine, gearMoved, gearToggled, sameGear } from './model.js';

const CHIP_ICON_PX = 18;
/** How long a press is held, in ms, before the chip lifts to be carried. */
const LIFT_HOLD_MS = 180;
/** Pointer travel, in CSS px, that lifts a pressed chip at once. */
const LIFT_TRAVEL_PX = 4;
/** How far, in CSS px, the drop mark stands off the first or last chip when the slot is at an end. */
const DROP_MARK_INSET_PX = 7;

export interface GearStripDeps {
  readonly label: string;
  readonly tip: string;
  readonly chips: ReturnType<typeof messages>['hud']['assistant']['gearChip'];
  readonly paintGood: GoodIconPainter;
  readonly goodIdOf: (goodType: number) => string | undefined;
  readonly goodLabel: (goodType: number) => string;
  /** False when the write was rejected. */
  readonly change: (choice: GearLine) => boolean;
}

export interface GearStrip {
  readonly element: HTMLElement;
  /** `stockOf` reads the seat's stock of a good by its id. */
  update(choice: GearLine, writable: boolean, stockOf: (goodId: string) => number): void;
}

interface Chip {
  readonly good: number;
  readonly goodId: string;
  readonly node: HTMLButtonElement;
  readonly count: HTMLElement;
  readonly rank: HTMLElement;
}

/**
 * A weapon class's weapon or armor line: the goods left to right in the order its recruits shop them,
 * each with its rank and stock. A chip held down lifts and follows the pointer while the others stand
 * still and a mark shows where it will land; the line is reordered when it is let go. Arrow keys move it
 * too. A click switches the good off for the class, crossed out in place, and back on.
 */
export function createGearStrip(deps: GearStripDeps): GearStrip {
  const copy = deps.chips;
  const line = element('div', 'on-asst-sub on-asst-gear');
  const caption = element('span', 'on-asst-sub__text');
  caption.textContent = deps.label;
  setTip(caption, deps.tip);
  const list = element('span', 'on-asst-gear__list');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', deps.label);
  /** Where a carried chip will land, between two chips. */
  const dropMark = element('i', 'on-asst-gear__drop');
  dropMark.hidden = true;
  line.append(caption, list, dropMark);

  let chips: Chip[] = [];
  let shown: GearLine = { order: [], off: [] };
  let shownKey = '';
  let writable = false;
  /** A press on a chip, its pointer captured by the list. It lifts once held or moved; until then a
   *  release is a click. */
  let held: {
    chip: Chip;
    pointer: number;
    startX: number;
    /** The press's event time, so a hold the lift timer has not reached yet is not taken for a click. */
    downAt: number;
    timer: ReturnType<typeof setTimeout>;
    lifted: boolean;
    /** Whether the pointer carried it past the travel threshold: only a carried chip moves. */
    carried: boolean;
    /** The slot it lands in among the other chips, in their order on screen. */
    slot: number;
  } | null = null;

  /** A press that leaves the line as it is sends nothing. */
  const press = (choice: GearLine): void => {
    if (!sameGear(choice, shown) && deps.change(choice)) shown = choice;
  };

  const lift = (): void => {
    if (held === null || held.lifted) return;
    clearTimeout(held.timer);
    held.lifted = true;
    held.chip.node.classList.add('is-lifted');
    list.classList.add('is-sorting');
  };

  /** Ends a press at event time `at`: a carried chip lands in its slot (or back home when `cancel`), a
   *  short press is a click, and a long one that never travelled leaves the line as it was. */
  const release = (cancel: boolean, at: number): void => {
    if (held === null) return;
    const { chip, carried, slot, downAt } = held;
    clearTimeout(held.timer);
    held = null;
    list.classList.remove('is-sorting');
    chip.node.classList.remove('is-lifted');
    chip.node.style.removeProperty('transform');
    dropMark.hidden = true;
    if (!cancel && carried) press(gearMoved(shown, chip.good, slot));
    else if (!cancel && at - downAt < LIFT_HOLD_MS) press(gearToggled(shown, chip.good));
    render();
  };

  /** Follow the pointer: the slot is how many of the other chips have their middle left of it, and the
   *  mark stands in the gap before the chip at that slot, or after the last. */
  const carry = (x: number, dx: number): void => {
    if (held === null) return;
    const carriedChip = held.chip;
    carriedChip.node.style.transform = `translateX(${dx}px)`;
    const others = chips.filter((c) => c !== carriedChip).map((c) => c.node.getBoundingClientRect());
    const slot = others.filter((box) => box.left + box.width / 2 < x).length;
    held.slot = slot;
    const origin = line.getBoundingClientRect().left;
    const next = others[slot];
    const prev = others[slot - 1];
    const gapX =
      prev !== undefined && next !== undefined
        ? (prev.right + next.left) / 2
        : next !== undefined
          ? next.left - DROP_MARK_INSET_PX
          : (prev?.right ?? origin) + DROP_MARK_INSET_PX;
    dropMark.style.left = `${gapX - origin}px`;
    dropMark.hidden = false;
  };

  const chipFor = (good: number): Chip | null => {
    const goodId = deps.goodIdOf(good);
    if (goodId === undefined) return null;
    const node = button(
      'on-asst-gear__chip',
      `<span class="on-asst-art">${goodIconMarkup(CHIP_ICON_PX)}<b class="on-asst-art__count"></b></span><i class="on-asst-gear__rank"></i>`,
    );
    const frame = node.querySelector<HTMLElement>('.on-good__frame');
    const count = node.querySelector<HTMLElement>('.on-asst-art__count');
    const rank = node.querySelector<HTMLElement>('.on-asst-gear__rank');
    if (frame === null || count === null || rank === null) throw new Error('assistant: gear chip');
    deps.paintGood(frame, goodId, CHIP_ICON_PX);
    const chip: Chip = { good, goodId, node, count, rank };

    node.addEventListener('keydown', (event) => {
      if (!writable) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        press(gearToggled(shown, good));
        render();
        return;
      }
      const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      if (step === 0) return;
      event.preventDefault();
      press(gearMoved(shown, good, shown.order.indexOf(good) + step));
      render();
      node.focus();
    });
    node.addEventListener('pointerdown', (event) => {
      if (!writable || event.button !== 0 || held !== null) return;
      event.preventDefault(); // no text selection or native drag while carrying
      node.focus({ preventScroll: true }); // which the prevented default would have done, so the keys work after a click
      list.setPointerCapture(event.pointerId);
      held = {
        chip,
        pointer: event.pointerId,
        startX: event.clientX,
        downAt: event.timeStamp,
        timer: setTimeout(lift, LIFT_HOLD_MS),
        lifted: false,
        carried: false,
        slot: 0,
      };
    });
    return chip;
  };

  list.addEventListener('pointermove', (event) => {
    if (held === null || held.pointer !== event.pointerId) return;
    const dx = event.clientX - held.startX;
    if (!held.carried) {
      if (Math.abs(dx) < LIFT_TRAVEL_PX) return;
      held.carried = true;
      lift();
    }
    carry(event.clientX, dx);
  });
  list.addEventListener('pointerup', (event) => {
    if (held?.pointer === event.pointerId) release(false, event.timeStamp);
  });
  list.addEventListener('pointercancel', (event) => {
    if (held?.pointer === event.pointerId) release(true, event.timeStamp);
  });
  list.addEventListener('lostpointercapture', (event) => {
    if (held?.pointer === event.pointerId) release(true, event.timeStamp);
  });

  /** Rebuild the chips when the goods change, else put them in order and restate their marks. */
  const render = (): void => {
    if (goodsKey(shown.order) !== goodsKey(chips.map((c) => c.good))) {
      chips = shown.order.flatMap((good) => chipFor(good) ?? []);
      list.replaceChildren(...chips.map((c) => c.node));
    }
    const byGood = new Map(chips.map((c) => [c.good, c]));
    chips = shown.order.flatMap((good) => byGood.get(good) ?? []); // screen order, which a carry reads
    let at = 0;
    let rank = 0;
    for (const good of shown.order) {
      const chip = byGood.get(good);
      if (chip === undefined) continue;
      if (list.children[at] !== chip.node) list.insertBefore(chip.node, list.children[at] ?? null);
      at += 1;
      const off = shown.off.includes(good);
      if (!off) rank += 1; // only the goods still on are counted
      write(chip.rank, off ? '' : String(rank));
      chip.node.classList.toggle('is-off', off);
      chip.node.setAttribute('aria-disabled', String(!writable));
      chip.node.setAttribute('aria-pressed', String(!off));
      const name = deps.goodLabel(good);
      const head = off
        ? formatMessage(copy.chipOff, { name })
        : formatMessage(copy.chip, { name, rank: String(rank) });
      chip.node.setAttribute('aria-label', head);
      setTip(chip.node, `${head}. ${off ? copy.chipOffTip : copy.chipTip}`);
    }
  };

  return {
    element: line,
    update: (choice, canWrite, stockOf) => {
      for (const chip of chips) {
        const amount = stockOf(chip.goodId);
        write(chip.count, String(amount));
        chip.count.classList.toggle('is-empty', amount === 0);
      }
      if (held?.lifted) return; // the line is the pointer's until the chip lands
      const key = `${choice.order.join(',')}|${choice.off.join(',')}|${canWrite}`;
      if (key === shownKey) return;
      shownKey = key;
      shown = choice;
      writable = canWrite;
      line.hidden = choice.order.length === 0;
      render();
    },
  };
}

/** The set of goods a line shows, whatever their order. */
const goodsKey = (goods: readonly number[]): string => [...goods].sort((a, b) => a - b).join(',');
