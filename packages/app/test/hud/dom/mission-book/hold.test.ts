import type { BriefingVoice, HypertextCallback } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type {
  MissionBriefingAnswer,
  MissionGoal,
  MissionReader,
} from '../../../../src/game/map/mission-brief.js';
import type { BookOpening, BookWindow } from '../../../../src/hud/dom/mission-book/book-window.js';
import type { GoalSlip } from '../../../../src/hud/dom/mission-book/goal-slip.js';
import {
  type BriefingViewTarget,
  createMissionBook,
  type MissionBookDeps,
} from '../../../../src/hud/dom/mission-book/index.js';

/** The mission book's contract without a document: the open book holds the game until it closes, a
 *  script's chapter is marked as delivered, and the briefing callbacks centre the view once per
 *  opening. */

const PAGE = 500;

/** Lets the beam's briefing answer land. */
const answered = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function goal(key: string, state: MissionGoal['state']): MissionGoal {
  return { key, text: key, emphasis: false, rule: 'authored', state };
}

function mount(pauseStopsClock = true, briefing: MissionBriefingAnswer = { history: [PAGE], page: PAGE }) {
  const holds: boolean[] = [];
  const openings: BookOpening[] = [];
  const dismiss: { run: () => void } = { run: () => undefined };
  const fire: { callback: (args: HypertextCallback['args'] | null, chapter?: number) => void } = {
    callback: () => undefined,
  };
  const spoken: (BriefingVoice | 'stop')[] = [];
  const centred: BriefingViewTarget[] = [];
  const goals: readonly MissionGoal[] = [goal('0', 'open')];
  let briefingHistory: readonly number[] = [PAGE];
  let answersVersion = 0;
  let open = false;
  let chapters: () => readonly (number | null)[] = () => [];
  const reader: MissionReader = {
    page: () => ({ title: '', blocks: [], lang: null }),
    goals: () => goals,
    missionName: 'Test',
  };
  const book: BookWindow = {
    element: {} as HTMLElement,
    isOpen: () => open,
    open: (opening) => {
      open = true;
      openings.push(opening);
    },
    close: () => {
      open = false;
    },
    refresh: () => undefined,
    rebuild: () => undefined,
    views: () => [],
    dispose: () => undefined,
  };
  const slip: GoalSlip = {
    update: () => undefined,
    dispose: () => undefined,
  };
  const deps: MissionBookDeps = {
    plane: {} as HTMLElement,
    reader,
    briefingHistory: () => briefingHistory,
    askBriefing: () => Promise.resolve(briefing),
    history: null,
    missionHuman: () => null,
    answersVersion: () => answersVersion,
    pictureUrl: (file) => file,
    pauseStopsClock,
    onHold: (held) => holds.push(held),
    onShowOnMap: () => undefined,
    onCentreView: (target) => centred.push(target),
    onSlipOpen: () => undefined,
    bookKey: () => null,
    cue: () => undefined,
    voice: {
      has: () => true,
      available: () => true,
      play: (voice) => spoken.push(voice),
      stop: () => spoken.push('stop'),
      toggle: () => undefined,
      seek: () => undefined,
      rate: () => 1,
      setRate: () => undefined,
      state: () => ({ voice: null, status: 'idle', positionS: 0, durationS: 0 }),
    },
  };
  const mission = createMissionBook(deps, {
    book: (bookDeps) => {
      dismiss.run = bookDeps.onDismiss;
      chapters = bookDeps.chapters;
      fire.callback = (args, chapter = 0) =>
        bookDeps.onCallback(args === null ? null : { args, lang: 'pol', chapter });
      return book;
    },
    slip: () => slip,
  });
  const setBriefingHistory = (history: readonly number[]): void => {
    briefingHistory = history;
    answersVersion++;
  };
  return {
    mission,
    holds,
    openings,
    dismiss,
    setBriefingHistory,
    fire,
    centred,
    spoken,
    chapters: () => chapters(),
  };
}

describe('the mission book`s pause', () => {
  it('adds a delivered page after the chapters the sim delivered earlier, and speaks it there', () => {
    const { mission, setBriefingHistory, chapters, openings, fire, spoken } = mount();
    setBriefingHistory([500, 511]);
    mission.showPage(501);
    expect(chapters()).toEqual([500, 511, 501]);
    expect(openings.at(-1)?.reading.chapter).toBe(2);
    fire.callback([2000, 3, 0], 2);
    expect(spoken).toEqual([{ lang: 'pol', id: 3 }]);
  });

  it('holds the game for a script`s chapter until the book closes, once', () => {
    const { mission, holds, openings, dismiss } = mount();
    mission.showPage(PAGE);
    mission.showPage(PAGE);
    expect(holds).toEqual([true]);
    expect(openings.at(-1)).toMatchObject({ arrival: true, paused: true });
    dismiss.run();
    expect(holds).toEqual([true, false]);
    expect(mission.isOpen()).toBe(false);
  });

  it('holds the game for the player`s own reading from the beam or the slip, without the arrival dim', async () => {
    const { mission, holds, openings } = mount();
    mission.toggle();
    await answered();
    expect(openings.at(-1)).toMatchObject({ arrival: false, paused: false });
    expect(holds).toEqual([true]);
    mission.close();
    expect(holds).toEqual([true, false]);
    mission.openGoals();
    expect(openings.at(-1)?.reading.tab).toBe('goals');
    mission.close();
    expect(holds).toEqual([true, false, true, false]);
  });

  it('opens from the beam on the start of the replayable chapter as of the click', async () => {
    const { mission, openings } = mount(true, { history: [PAGE, PAGE + 1, PAGE + 2], page: PAGE + 1 });
    mission.toggle();
    expect(openings).toEqual([]);
    await answered();
    expect(openings.at(-1)?.reading).toMatchObject({ tab: 'brief', chapter: 1, spread: 0 });
  });

  it('drops a beam opening still waiting when the book closes or a script opens it', async () => {
    const { mission, openings } = mount();
    mission.toggle();
    mission.close();
    await answered();
    expect(mission.isOpen()).toBe(false);
    mission.toggle();
    mission.showPage(PAGE);
    await answered();
    expect(openings).toHaveLength(1);
    expect(openings[0]).toMatchObject({ arrival: true });
  });

  it('keeps one hold when a script`s chapter opens over the player`s reading', async () => {
    const { mission, holds, openings } = mount();
    mission.toggle();
    await answered();
    mission.showPage(PAGE);
    expect(openings.at(-1)).toMatchObject({ arrival: true, paused: true });
    mission.openGoals();
    expect(openings.at(-1)).toMatchObject({ arrival: true });
    mission.close();
    expect(holds).toEqual([true, false]);
  });

  it('shows a chapter without dimming the map on a shared clock', () => {
    const { mission, openings } = mount(false);
    mission.showPage(PAGE);
    expect(openings.at(-1)).toMatchObject({ arrival: true, paused: false });
  });
});

describe('the briefing callbacks', () => {
  const HUMANS_5: HypertextCallback['args'] = [1001, 5, 0];
  const NODE: HypertextCallback['args'] = [1000, 296, 188];
  const SOUND: HypertextCallback['args'] = [2000, 3, 0];

  it('centre the view once per opening, the first that moves a view spending the flag', async () => {
    const { mission, fire, centred } = mount();
    mission.toggle();
    await answered();
    fire.callback(SOUND);
    fire.callback([999, 1, 2]);
    fire.callback(HUMANS_5);
    fire.callback(NODE);
    expect(centred).toEqual([{ kind: 'group', group: 'human', id: 5 }]);
    mission.close();
    mission.toggle();
    await answered();
    fire.callback(NODE);
    expect(centred.at(-1)).toEqual({ kind: 'node', hx: 296, hy: 188 });
    expect(centred).toHaveLength(2);
  });

  it('reset the flag when a script`s chapter opens the closed book', async () => {
    const { mission, fire, centred } = mount();
    mission.toggle();
    await answered();
    fire.callback(NODE);
    mission.close();
    mission.showPage(PAGE);
    fire.callback(HUMANS_5);
    expect(centred).toHaveLength(2);
  });

  it('keep the spent flag for a chapter delivered to the open book', async () => {
    const { mission, fire, centred } = mount();
    mission.toggle();
    await answered();
    fire.callback(NODE);
    mission.showPage(PAGE);
    fire.callback(HUMANS_5);
    expect(centred).toHaveLength(1);
  });

  it('speak a delivered chapter once, on through its page turns, and silence it on the close', () => {
    const { mission, fire, spoken, centred } = mount();
    mission.showPage(PAGE);
    fire.callback(SOUND);
    fire.callback(null);
    fire.callback(NODE);
    fire.callback(SOUND);
    expect(spoken).toEqual([{ lang: 'pol', id: 3 }]);
    mission.close();
    expect(spoken.at(-1)).toBe('stop');
    expect(centred).toEqual([{ kind: 'node', hx: 296, hy: 188 }]);
  });

  it('start no narration in a book the reader opened, on any chapter or turn', () => {
    const { mission, fire, spoken } = mount();
    mission.toggle();
    fire.callback(SOUND);
    fire.callback(null);
    fire.callback(SOUND, 1);
    mission.close();
    mission.openGoals();
    fire.callback(SOUND);
    expect(spoken.filter((entry) => entry !== 'stop')).toEqual([]);
  });

  it('speak a page delivered over the reader`s own open book, and only on its own chapter', () => {
    const { mission, fire, spoken } = mount();
    mission.toggle();
    fire.callback(SOUND);
    mission.showPage(PAGE);
    fire.callback(SOUND, 1);
    expect(spoken).toEqual([]);
    fire.callback(SOUND);
    expect(spoken).toEqual([{ lang: 'pol', id: 3 }]);
  });

  it('drop a delivered chapter`s narration on the close, so a later reader opening is silent', async () => {
    const { mission, fire, spoken } = mount();
    mission.showPage(PAGE);
    mission.close();
    mission.toggle();
    await answered();
    fire.callback(SOUND);
    expect(spoken).toEqual(['stop']);
  });

  it('speak a delivered page anew, the chapter already shown included', () => {
    const { mission, fire, spoken } = mount();
    mission.showPage(PAGE);
    fire.callback(SOUND);
    mission.showPage(PAGE);
    fire.callback(SOUND);
    expect(spoken.filter((entry) => entry !== 'stop')).toEqual([
      { lang: 'pol', id: 3 },
      { lang: 'pol', id: 3 },
    ]);
  });
});
