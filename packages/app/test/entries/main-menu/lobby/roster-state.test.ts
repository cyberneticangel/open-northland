import { describe, expect, it } from 'vitest';
import {
  claimSeat,
  computerSeats,
  hasClaimableSeat,
  initialRosterState,
  setSlotColor,
  setVacantMode,
  vacantOffers,
  wearerOf,
} from '../../../../src/entries/main-menu/lobby/roster-state.js';

describe('roster state', () => {
  const players = [
    {
      player: 0,
      type: 'human',
      tribeId: 1,
      colorId: 7,
      claimable: true,
      hidden: false,
      aiAllowed: true,
      noneAllowed: true,
      hasComputerControl: true,
    },
    {
      player: 1,
      type: 'human',
      tribeId: 2,
      colorId: 4,
      claimable: true,
      hidden: false,
      aiAllowed: true,
      noneAllowed: true,
      hasComputerControl: true,
    },
    {
      player: 2,
      type: 'ai',
      tribeId: 4,
      colorId: 9,
      claimable: false,
      hidden: false,
      aiAllowed: true,
      noneAllowed: true,
      hasComputerControl: true,
    },
  ] as const;

  it('lists no AI seat until a slot is toggled to it', () => {
    let state = claimSeat(initialRosterState(players), 0);
    expect(computerSeats(state, players)).toEqual([]);
    state = setVacantMode(state, 1, 'computer');
    expect(computerSeats(state, players)).toEqual([1]);
  });

  it('rejects a colour another slot wears and accepts re-picking your own', () => {
    const state = initialRosterState(players);
    expect(setSlotColor(state, 0, 4)).toBeNull(); // slot 1 wears green
    expect(setSlotColor(state, 0, 7)).not.toBeNull(); // own colour, no-op accepted
  });

  it('offers only the vacant modes the map allows, and locks the map computer seat', () => {
    const seat = {
      player: 1,
      type: 'human',
      tribeId: 1,
      colorId: 1,
      claimable: true,
      hidden: false,
      hasComputerControl: true,
    } as const;
    expect(vacantOffers({ ...seat, aiAllowed: true, noneAllowed: true })).toEqual([
      'computer',
      'idle',
      'absent',
    ]);
    expect(vacantOffers({ ...seat, aiAllowed: false, noneAllowed: true })).toEqual(['idle', 'absent']);
    expect(vacantOffers({ ...seat, aiAllowed: true, noneAllowed: false })).toEqual(['computer', 'idle']);
    expect(vacantOffers({ ...seat, aiAllowed: false, noneAllowed: false })).toEqual(['idle']);
    const computer = { ...seat, type: 'ai', claimable: false, aiAllowed: true, noneAllowed: true } as const;
    expect(vacantOffers(computer)).toEqual(['map-ai']);
  });

  it('keeps closed authored seats out of the selectable modes', () => {
    const closed = { ...players[2], type: 'none' as const };
    expect(vacantOffers(closed)).toEqual(['absent']);
    expect(initialRosterState([closed]).vacantModes.get(2)).toBe('absent');
    expect(computerSeats(initialRosterState([closed]), [closed])).toEqual([]);
  });

  it('keeps authored duplicate colours pickable for their own slot and blocks new duplicates', () => {
    // Real rosters duplicate colours freely (tutorial maps are all-blue; multiplayer_104 wears
    // black three times) - "worn" must always be relative to the asking slot.
    const dupes = [
      {
        player: 0,
        type: 'human',
        tribeId: 1,
        colorId: 0,
        claimable: true,
        hidden: false,
        aiAllowed: true,
        noneAllowed: true,
        hasComputerControl: true,
      },
      {
        player: 1,
        type: 'human',
        tribeId: 1,
        colorId: 0,
        claimable: true,
        hidden: false,
        aiAllowed: true,
        noneAllowed: true,
        hasComputerControl: true,
      },
      {
        player: 2,
        type: 'human',
        tribeId: 1,
        colorId: 4,
        claimable: true,
        hidden: false,
        aiAllowed: true,
        noneAllowed: true,
        hasComputerControl: true,
      },
    ] as const;
    const state = initialRosterState(dupes);
    expect(wearerOf(state, 1, 0)).toBe(0); // slot 0 also wears blue…
    expect(setSlotColor(state, 1, 0)).not.toBeNull(); // …but re-picking your own blue is a no-op accept
    expect(setSlotColor(state, 2, 0)).toBeNull(); // a third slot cannot newly join the duplicate
    expect(setSlotColor(state, 1, 3)).not.toBeNull(); // moving off the duplicate is free
  });

  it('does not gate Start when a roster offers no claimable seat', () => {
    const allAi = [
      {
        player: 0,
        type: 'ai',
        tribeId: 1,
        colorId: 0,
        claimable: false,
        hidden: false,
        aiAllowed: true,
        noneAllowed: true,
        hasComputerControl: true,
      },
    ] as const;
    expect(hasClaimableSeat(allAi)).toBe(false);
    expect(hasClaimableSeat([{ ...allAi[0], claimable: true, hidden: true }])).toBe(false);
    expect(hasClaimableSeat([{ ...allAi[0], claimable: true }])).toBe(true);
  });
});
