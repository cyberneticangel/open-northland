import { describe, expect, it } from 'vitest';
import type { MusicCue, MusicSequence } from '../../../src/index.js';
import {
  MusicPlayer,
  type MusicScheduler,
  STANDBY_PREFETCH_LATEST_S,
  STANDBY_PREFETCH_LEAD_S,
} from '../../../src/web/engine/music-player.js';
import { FakeContext, flush } from '../../support/fake-audio.js';
import { musicTrack } from '../../support/music-manifest.js';

/** The standby prefetch waits for the running cue's end instead of competing with a boot's loads, but
 *  not past its latest start for a cue that loops on and on. */

/** One fetched byte decodes to one second, so this serves a 120 s file. */
const TRACK_S = 120;
/** First pass ends at 50 s: a one-pass cue plays 50 s, its lead opening before the latest start. */
const LONG = musicTrack('theme_viking_neutral', { loopStartS: 50, loopEndS: TRACK_S });
const FIGHT = musicTrack('attack_arabs', { loopStartS: 50, loopEndS: TRACK_S });
const FADE_S = 1;
const CUE_S = LONG.loopStartS;
const PREFETCH_AT_S = CUE_S - FADE_S - STANDBY_PREFETCH_LEAD_S;

interface ManualClock {
  readonly schedule: MusicScheduler;
  /** Move the audio clock to `at` and run the tasks due by then. */
  advanceTo(at: number): void;
}

function manualClock(ctx: FakeContext): ManualClock {
  let tasks: { at: number; task: () => void }[] = [];
  return {
    schedule: (delayS, task) => {
      const entry = { at: ctx.currentTime + delayS, task };
      tasks.push(entry);
      return () => {
        tasks = tasks.filter((t) => t !== entry);
      };
    },
    advanceTo(at) {
      ctx.currentTime = at;
      const due = tasks.filter((t) => t.at <= at);
      tasks = tasks.filter((t) => t.at > at);
      for (const { task } of due) task();
    },
  };
}

/** A calm sequence on LONG whose fight cut-in opens on FIGHT, its standby. */
function calmWithFight(dropped: string[] = [], passes = 1): MusicSequence & { fight: boolean } {
  const cue = (track: typeof LONG): MusicCue => ({
    track,
    passes,
    gapBeforeS: 0,
    fadeInS: 0,
    fadeS: FADE_S,
  });
  return {
    fight: false,
    next() {
      return cue(this.fight ? FIGHT : LONG);
    },
    drop(file) {
      dropped.push(file);
    },
    standby: () => FIGHT,
  };
}

function harness() {
  const ctx = new FakeContext();
  ctx.state = 'running';
  const clock = manualClock(ctx);
  const fetched: string[] = [];
  const held = new Map<string, () => void>();
  const fetchBytes = (url: string): Promise<ArrayBuffer> => {
    fetched.push(url);
    if (!url.endsWith(FIGHT.file)) return Promise.resolve(new ArrayBuffer(TRACK_S));
    // The fight track's fetch lands only when the test releases it.
    return new Promise((resolve) => held.set(url, () => resolve(new ArrayBuffer(TRACK_S))));
  };
  const player = new MusicPlayer(
    ctx as unknown as AudioContext,
    ctx.createGain() as unknown as AudioNode,
    '/music/',
    fetchBytes,
    () => true,
    clock.schedule,
  );
  const release = (file: string): void => held.get(`/music/${file}`)?.();
  return { ctx, clock, fetched, player, release };
}

describe('standby prefetch timing', () => {
  it('fetches only the playing cue when play starts', async () => {
    const { clock, fetched, player } = harness();
    player.play(calmWithFight());
    await flush();
    clock.advanceTo(PREFETCH_AT_S - 1);
    expect(fetched).toEqual([`/music/${LONG.file}`]);
  });

  it('fetches the standby once the cue is within the lead of its end fade', async () => {
    const { clock, fetched, player } = harness();
    player.play(calmWithFight());
    await flush();
    clock.advanceTo(PREFETCH_AT_S);
    expect(fetched).toEqual([`/music/${LONG.file}`, `/music/${FIGHT.file}`]);
  });

  it('fetches the standby of a cue that loops on by its latest start', async () => {
    const LOOPED_PASSES = 100;
    const { clock, fetched, player } = harness();
    player.play(calmWithFight([], LOOPED_PASSES));
    await flush();
    clock.advanceTo(STANDBY_PREFETCH_LATEST_S - 1);
    expect(fetched).toEqual([`/music/${LONG.file}`]);
    clock.advanceTo(STANDBY_PREFETCH_LATEST_S);
    expect(fetched).toEqual([`/music/${LONG.file}`, `/music/${FIGHT.file}`]);
  });

  it('fetches the upcoming cue within the lead of the end fade and opens it without another fetch', async () => {
    const { ctx, clock, fetched, player } = harness();
    const NEXT = musicTrack('theme_viking_friendly', { loopStartS: 50, loopEndS: TRACK_S });
    let handed = 0;
    player.play({
      next: () => ({
        track: handed++ === 0 ? LONG : NEXT,
        passes: 1,
        gapBeforeS: 0,
        fadeInS: 0,
        fadeS: FADE_S,
      }),
      drop: () => {},
      upcoming: () => NEXT,
    });
    await flush();
    clock.advanceTo(PREFETCH_AT_S - 1);
    expect(fetched).toEqual([`/music/${LONG.file}`]);
    clock.advanceTo(PREFETCH_AT_S);
    await flush();
    expect(fetched).toEqual([`/music/${LONG.file}`, `/music/${NEXT.file}`]);
    clock.advanceTo(CUE_S);
    ctx.sources[0]?.onended?.();
    await flush();
    expect(ctx.sources).toHaveLength(2);
    expect(fetched.filter((url) => url.endsWith(NEXT.file))).toHaveLength(1);
  });

  it('fetches the upcoming cue at once when a mood change hands over at a pass end', async () => {
    const { fetched, player } = harness();
    const NEXT = musicTrack('theme_viking_friendly', { loopStartS: 50, loopEndS: TRACK_S });
    player.play({
      next: () => ({ track: LONG, passes: 1, gapBeforeS: 0, fadeInS: 0, fadeS: FADE_S }),
      drop: () => {},
      upcoming: () => NEXT,
    });
    await flush();
    player.endAtPassEnd();
    expect(fetched).toEqual([`/music/${LONG.file}`, `/music/${NEXT.file}`]);
  });

  it('never fetches the standby of a cue stopped before the lead', async () => {
    const { clock, fetched, player } = harness();
    player.play(calmWithFight());
    await flush();
    player.stop();
    clock.advanceTo(CUE_S);
    await flush();
    expect(fetched).toEqual([`/music/${LONG.file}`]);
  });

  it('neither fetches nor drops the standby when the context closed without a stop', async () => {
    const { ctx, clock, fetched, player } = harness();
    const dropped: string[] = [];
    player.play(calmWithFight(dropped));
    await flush();
    ctx.state = 'closed';
    clock.advanceTo(PREFETCH_AT_S);
    await flush();
    expect(fetched).toEqual([`/music/${LONG.file}`]);
    expect(dropped).toEqual([]);
  });

  it('fetches the standby at once when a mood change arrives before the lead', async () => {
    const { fetched, player } = harness();
    player.play(calmWithFight());
    await flush();
    player.keepOrInterrupt();
    expect(fetched).toEqual([`/music/${LONG.file}`, `/music/${FIGHT.file}`]);
  });

  it('opens a cut-in onto the standby on the prefetch in flight', async () => {
    const { ctx, clock, fetched, player, release } = harness();
    const sequence = calmWithFight();
    player.play(sequence);
    await flush();
    clock.advanceTo(PREFETCH_AT_S);
    sequence.fight = true;
    player.interrupt();
    await flush();
    expect(ctx.sources).toHaveLength(1); // still waiting on the fetch
    release(FIGHT.file);
    await flush();
    expect(fetched.filter((url) => url.endsWith(FIGHT.file))).toHaveLength(1);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[1]?.buffer).toMatchObject({ duration: TRACK_S });
  });
});
