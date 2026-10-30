// @vitest-environment jsdom
import type { NarrationRate } from '@open-northland/audio';
import type { BriefingVoice } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BriefingVoicePlayer,
  type BriefingVoiceState,
  createVoiceRows,
  VOICE_KEY_STEP_S,
  VOICE_PAGE_STEP_S,
  type VoiceRows,
} from '../../../../src/hud/dom/mission-book/voice-row.js';
import { messages } from '../../../../src/i18n/index.js';

/** The narration player row's input: the toggle, the seek bar's keys and drag, the disabled state of a
 *  clip that cannot play, and a drag the row's replacement or the book's close ends. */

const VOICE: BriefingVoice = { lang: 'pol', id: 1 };
const DURATION_S = 120;
const POSITION_S = 40;
const BAR = DOMRect.fromRect({ x: 100, y: 0, width: 200, height: 10 });

function fakePlayer() {
  let state: BriefingVoiceState = {
    voice: VOICE,
    status: 'paused',
    positionS: POSITION_S,
    durationS: DURATION_S,
  };
  const control: { available: boolean; rate: NarrationRate } = { available: true, rate: 1 };
  const reset = (): void => {
    state = { ...state, positionS: POSITION_S };
  };
  const player = {
    has: () => true,
    available: () => control.available,
    play: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn((_voice: BriefingVoice) => {
      state = { ...state, status: state.status === 'playing' ? 'paused' : 'playing' };
    }),
    seek: vi.fn((_voice: BriefingVoice, atS: number) => {
      state = { ...state, positionS: Math.min(DURATION_S, Math.max(0, atS)) };
    }),
    rate: () => control.rate,
    setRate: vi.fn((rate: NarrationRate) => {
      control.rate = rate;
    }),
    state: () => state,
  } satisfies BriefingVoicePlayer;
  return { player, control, reset };
}

interface Mounted {
  readonly rows: VoiceRows;
  readonly scene: HTMLElement;
  readonly player: ReturnType<typeof fakePlayer>['player'];
  readonly control: { available: boolean; rate: NarrationRate };
  /** Put the line back at its starting position. */
  readonly reset: () => void;
  readonly cues: string[];
  readonly row: () => HTMLElement;
  readonly bar: () => HTMLElement;
  readonly toggle: () => HTMLButtonElement;
  /** Lay the rows out anew, as a spread rebuilt by a page turn. */
  readonly relayout: () => void;
}

function mount(): Mounted {
  const scene = document.createElement('div');
  document.body.append(scene);
  const { player, control, reset } = fakePlayer();
  const cues: string[] = [];
  const rows = createVoiceRows({ scene, player, voice: () => VOICE, cue: (cue) => cues.push(cue) });
  const relayout = (): void => {
    scene.innerHTML = rows.markup();
    rows.refresh(scene);
  };
  relayout();
  const find = <T extends HTMLElement>(selector: string): T => {
    const found = scene.querySelector<T>(selector);
    if (found === null) throw new Error(`no ${selector}`);
    return found;
  };
  return {
    rows,
    scene,
    player,
    control,
    reset,
    cues,
    row: () => find('.on-voice'),
    bar: () => find('.on-voice__bar'),
    toggle: () => find<HTMLButtonElement>('[data-voice-toggle]'),
    relayout,
  };
}

const key = (target: HTMLElement, name: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

const pointer = (target: HTMLElement, type: string, clientX = BAR.x): void => {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX }),
  );
};

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(BAR);
  const captured = new Set<Element>();
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: {
      configurable: true,
      value(this: Element) {
        captured.add(this);
      },
    },
    hasPointerCapture: {
      configurable: true,
      value(this: Element) {
        return captured.has(this);
      },
    },
    releasePointerCapture: {
      configurable: true,
      value(this: Element) {
        captured.delete(this);
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const name of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'])
    Reflect.deleteProperty(HTMLElement.prototype, name);
  document.body.replaceChildren();
});

describe('the narration player row', () => {
  it('toggles the line on a click and on Space, with the confirm cue', () => {
    const { player, cues, toggle, row, rows, scene } = mount();
    toggle().click();
    expect(player.toggle).toHaveBeenCalledWith(VOICE);
    rows.refresh(scene);
    expect(row().dataset.state).toBe('playing');
    expect(toggle().getAttribute('aria-label')).toBe(messages().hud.missionBook.voicePause);
    const space = key(toggle(), ' ');
    expect(space.defaultPrevented).toBe(true);
    expect(player.toggle).toHaveBeenCalledTimes(2);
    expect(cues).toEqual(['confirm', 'confirm']);
  });

  it('steps the tempo on a click and on Space, back to the recorded one past the fastest', () => {
    const { player, cues, row, rows, scene } = mount();
    const rate = (): HTMLButtonElement => {
      const button = row().querySelector<HTMLButtonElement>('[data-voice-rate]');
      if (button === null) throw new Error('no tempo button');
      return button;
    };
    expect(rate().textContent).toBe('1×');
    rate().click();
    rows.refresh(scene);
    expect(rate().dataset.rate).toBe('1.25');
    expect(key(rate(), ' ').defaultPrevented).toBe(true);
    rate().click();
    rate().click();
    expect(player.setRate.mock.calls.map(([to]) => to)).toEqual([1.25, 1.5, 2, 1]);
    expect(player.toggle).not.toHaveBeenCalled();
    expect(cues).toEqual(['confirm', 'confirm', 'confirm', 'confirm']);
  });

  it('moves the line by the arrows and the page keys, and to either end by Home and End', () => {
    const { player, bar, reset } = mount();
    const seeks: [string, number][] = [
      ['ArrowLeft', POSITION_S - VOICE_KEY_STEP_S],
      ['ArrowRight', POSITION_S + VOICE_KEY_STEP_S],
      ['PageDown', POSITION_S - VOICE_PAGE_STEP_S],
      ['PageUp', POSITION_S + VOICE_PAGE_STEP_S],
      ['Home', 0],
      ['End', DURATION_S],
    ];
    for (const [name, atS] of seeks) {
      reset();
      expect(key(bar(), name).defaultPrevented).toBe(true);
      expect(player.seek).toHaveBeenLastCalledWith(VOICE, atS);
    }
    expect(key(bar(), 'a').defaultPrevented).toBe(false);
  });

  it('seeks where a drag across the bar ends', () => {
    const { player, bar } = mount();
    pointer(bar(), 'pointerdown', BAR.x);
    pointer(bar(), 'pointermove', BAR.x + BAR.width / 2);
    expect(player.seek).not.toHaveBeenCalled();
    pointer(bar(), 'pointerup', BAR.x + BAR.width / 2);
    expect(player.seek).toHaveBeenCalledWith(VOICE, DURATION_S / 2);
  });

  it('drops a drag the row`s replacement, the book`s close or a lost capture ends, and paints on', () => {
    const { player, bar, row, rows, scene, relayout } = mount();
    const paintsAfter = (end: () => void): string | undefined => {
      pointer(bar(), 'pointerdown', BAR.x);
      end();
      player.toggle(VOICE);
      rows.refresh(scene);
      return row().dataset.state;
    };
    expect(paintsAfter(relayout)).toBe('playing');
    expect(paintsAfter(() => rows.hide())).toBe('paused');
    expect(row().classList.contains('on-voice--drag')).toBe(false);
    expect(
      paintsAfter(() => bar().dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true }))),
    ).toBe('playing');
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('disables the row of a clip that cannot play, which ignores its input', () => {
    const { player, control, cues, toggle, bar, row, rows, scene } = mount();
    control.available = false;
    rows.refresh(scene);
    expect(row().dataset.state).toBe('unavailable');
    expect(toggle().disabled).toBe(true);
    expect(toggle().getAttribute('aria-label')).toBe(messages().hud.missionBook.voiceUnavailable);
    expect(bar().getAttribute('aria-disabled')).toBe('true');
    expect(bar().tabIndex).toBe(-1);
    toggle().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    key(bar(), 'End');
    pointer(bar(), 'pointerdown');
    pointer(bar(), 'pointerup');
    expect(player.toggle).not.toHaveBeenCalled();
    expect(player.seek).not.toHaveBeenCalled();
    expect(cues).toEqual([]);
    control.available = true;
    rows.refresh(scene);
    expect(toggle().disabled).toBe(false);
    expect(bar().tabIndex).toBe(0);
  });

  it('stops answering input once disposed', () => {
    const { player, toggle, bar, rows } = mount();
    rows.dispose();
    toggle().click();
    key(bar(), 'Home');
    expect(player.toggle).not.toHaveBeenCalled();
    expect(player.seek).not.toHaveBeenCalled();
  });
});
