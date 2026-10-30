import type { AssistantArmorOrder, PlayerCommand } from '@open-northland/sim';
import type { AssistantGearSeam } from '../../hud/dom/assistant-window/index.js';
import type { SessionHost } from '../../session/index.js';

const NO_LINE: AssistantArmorOrder = { order: [], off: [] };

/** Live armor-line seam for the seat `player` names, read on every call so a spectator's window follows
 *  its watched seat; no seat reads an empty line. A read-only session rejects every write. */
export function assistantArmorSeam(
  host: Pick<SessionHost, 'assistantArmorOrder'>,
  player: () => number | null,
  enqueue: (command: PlayerCommand) => void,
  writable = true,
): AssistantGearSeam {
  return {
    read: (intent) => {
      const seat = player();
      return seat === null ? NO_LINE : host.assistantArmorOrder(seat, intent);
    },
    set: (intent, choice) => {
      const seat = player();
      if (!writable || seat === null) return false;
      enqueue({ kind: 'setAssistantArmorOrder', player: seat, intent, order: choice.order, off: choice.off });
      return true;
    },
  };
}

/** The weapon line's twin of {@link assistantArmorSeam}: the order is the class's weapon order, and a
 *  weapon is off while the seat vetoes it. A change sends the whole line, the order and every good's
 *  veto, so a second press made before the first lands still wins. */
export function assistantWeaponSeam(
  host: Pick<SessionHost, 'assistantWeaponOrder' | 'assistantWeaponVetoes'>,
  player: () => number | null,
  enqueue: (command: PlayerCommand) => void,
  writable = true,
): AssistantGearSeam {
  return {
    read: (intent) => {
      const seat = player();
      if (seat === null) return NO_LINE;
      const order = host.assistantWeaponOrder(seat, intent);
      const vetoed = host.assistantWeaponVetoes(seat);
      return { order, off: order.filter((good) => vetoed.includes(good)) };
    },
    set: (intent, choice) => {
      const seat = player();
      if (!writable || seat === null) return false;
      enqueue({ kind: 'setAssistantWeaponOrder', player: seat, intent, order: choice.order });
      for (const goodType of choice.order) {
        enqueue({
          kind: 'setAssistantWeaponVeto',
          player: seat,
          goodType,
          vetoed: choice.off.includes(goodType),
        });
      }
      return true;
    },
  };
}
