import type { HalfCellNode } from '@open-northland/sim';
import type { MessageNaming, RaisedMessage } from './raise.js';
import { USER_MESSAGE_TYPE } from './types.js';

/** The note that a trader's route refused a house of `player`, at `at`, because the two tribes are not
 *  friends both ways. */
export function tradeRefusedNote(
  player: number,
  at: HalfCellNode | null,
  naming: Pick<MessageNaming, 'player' | 'text'>,
): RaisedMessage {
  const type = USER_MESSAGE_TYPE.tradeRefused;
  return {
    pending: { type, subject: null, at, about: player, goodType: null, technologies: null, jobType: null },
    compose: () =>
      naming.text(type, {
        subjectName: naming.player(player),
        jobLabel: null,
        goodName: null,
        stanceName: null,
      }),
  };
}
