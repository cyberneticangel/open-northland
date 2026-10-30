import { describe, expect, it } from 'vitest';
import { WaterClock } from '../../../src/data/terrain/index.js';

const FRAME_SECONDS = 1 / 60;

/** Run `frames` frames of real time while the game clock runs at `gameRate` game seconds per second. */
function run(
  clock: WaterClock,
  frames: number,
  gameRate: number,
  paused = false,
  start = { game: 0, real: 0 },
): number {
  let water = 0;
  for (let i = 0; i <= frames; i++) {
    water = clock.advance(start.game + i * FRAME_SECONDS * gameRate, start.real + i * FRAME_SECONDS, paused);
  }
  return water;
}

describe('WaterClock', () => {
  it('keeps one pace at every game speed', () => {
    const second = 60;
    expect(run(new WaterClock(), second, 1)).toBeCloseTo(1, 6);
    expect(run(new WaterClock(), second, 3)).toBeCloseTo(1, 6);
    expect(run(new WaterClock(), second, 10)).toBeCloseTo(1, 6);
  });

  it('keeps its pace while a late tick holds the game clock', () => {
    expect(run(new WaterClock(), 60, 0)).toBeCloseTo(1, 6);
  });

  it('stands while the game is paused', () => {
    const clock = new WaterClock();
    const before = run(clock, 30, 3);
    const paused = run(clock, 120, 0, true, { game: 30 * FRAME_SECONDS * 3, real: 31 * FRAME_SECONDS });
    expect(paused).toBeCloseTo(before, 6);
  });

  it('steps at most a tenth of a second over a long frame', () => {
    const clock = new WaterClock();
    clock.advance(0, 0, false);
    expect(clock.advance(1, 5, false)).toBeCloseTo(0.1, 6);
  });

  it('reads the game clock in a still capture', () => {
    expect(new WaterClock().advance(7.5, undefined, false)).toBe(7.5);
  });
});
