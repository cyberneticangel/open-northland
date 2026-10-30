import type { Command } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { assistantWeaponSeam } from '../../../src/view/assistant/gear-lines.js';

const SWORD_LONG = 40;
const SWORD_SHORT = 41;
const SEAT = 2;

describe('assistantWeaponSeam', () => {
  it('reads a vetoed weapon as off, and writes the whole line', () => {
    const sent: Command[] = [];
    const seam = assistantWeaponSeam(
      {
        assistantWeaponOrder: () => [SWORD_LONG, SWORD_SHORT],
        assistantWeaponVetoes: () => [SWORD_SHORT],
      },
      () => SEAT,
      (c) => sent.push(c),
    );
    expect(seam.read('trainSword')).toEqual({ order: [SWORD_LONG, SWORD_SHORT], off: [SWORD_SHORT] });

    expect(seam.set('trainSword', { order: [SWORD_SHORT, SWORD_LONG], off: [SWORD_LONG] })).toBe(true);
    expect(sent).toEqual([
      {
        kind: 'setAssistantWeaponOrder',
        player: SEAT,
        intent: 'trainSword',
        order: [SWORD_SHORT, SWORD_LONG],
      },
      { kind: 'setAssistantWeaponVeto', player: SEAT, goodType: SWORD_SHORT, vetoed: false },
      { kind: 'setAssistantWeaponVeto', player: SEAT, goodType: SWORD_LONG, vetoed: true },
    ]);
  });
});
