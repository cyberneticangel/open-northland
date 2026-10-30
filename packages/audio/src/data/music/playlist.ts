import type { DiplomacyState } from '@open-northland/sim';
import type { MusicVariants } from './catalog.js';
import type { MusicManifest, MusicTrack } from './manifest.js';
import { ownCalmStem, ownTenseStem } from './mood.js';
import { type MusicIntensity, type MusicPools, stemsByIntensity } from './pools.js';
import type { MusicCue, MusicSequence } from './sequence.js';

/**
 * A game's soundtrack, from one of two sources the player picks. The map's own music loops its
 * segment without a break and switches between the segment's mood variants, the way the original
 * does. The nation's music shuffles the player's culture's calm stems back to back and cuts to its
 * tense stems for a fight. The nation soundtrack and every number below are this reimplementation's
 * choices, tuned by ear.
 */

/** Where a game's music comes from. */
export type MusicSource = 'map' | 'nation';

/** The choices in the order a settings page lists them. */
export const MUSIC_SOURCES: readonly MusicSource[] = ['map', 'nation'];

export const DEFAULT_MUSIC_SOURCE: MusicSource = 'map';

/** A stored choice read back: a known source, else the default. */
export function parseMusicSource(value: unknown): MusicSource {
  return MUSIC_SOURCES.find((source) => source === value) ?? DEFAULT_MUSIC_SOURCE;
}

/** What a playlist plays: a map's own stems, or a nation's pools. */
export type PlaylistMusic =
  | { readonly source: 'map'; readonly variants: MusicVariants }
  | { readonly source: 'nation'; readonly pools: MusicPools };

/** The music `source` asks for, or the other source when that one has nothing: a map without music
 *  plays the nation's, a seat without a nation plays the map's. Null when neither has any. */
export function choosePlaylistMusic(
  source: MusicSource,
  mapVariants: MusicVariants | null,
  nationPools: MusicPools | null,
): PlaylistMusic | null {
  const map: PlaylistMusic | null = mapVariants === null ? null : { source: 'map', variants: mapVariants };
  const nation: PlaylistMusic | null =
    nationPools === null || nationPools.calm.length + nationPools.tense.length === 0
      ? null
      : { source: 'nation', pools: nationPools };
  return source === 'map' ? (map ?? nation) : (nation ?? map);
}

/** Passes a map's stem plays: so many that it loops unbroken until a mood change ends it at a pass end. */
export const MAP_PASSES = 1000;
/** Passes a nation's calm cue plays, drawn per cue: one or two passes of a 50-127 s loop region. */
export const CALM_PASSES_MIN = 1;
export const CALM_PASSES_MAX = 2;
/** Passes a tense stem holds before the fight rotates to another one. */
export const TENSE_PASSES = 3;
/** Seconds a calm cue fades out over before the next one. */
export const CALM_FADE_S = 2.5;
/** Seconds a calm cue rises over, so a rendered file's first downbeat does not punch in. */
export const CALM_FADE_IN_S = 1.5;
/** Seconds a tense cue fades out over when it hands over to the next one. */
export const TENSE_FADE_S = 1.5;
/** Seconds a tense cue rises over: it cuts in under the outgoing cue's fade, so it lands fast but not
 *  as a click. */
export const TENSE_FADE_IN_S = 0.3;
/** Silence between two cues: none, the fades make the handover. */
export const CUE_GAP_S = 0;
/** The longest a fight's music plays on once the mood has calmed: the handover waits for a pass end,
 *  but a pass can run two minutes, so past this it fades out wherever it is. */
export const CALM_RETURN_MAX_WAIT_S = 25;

/** A uniform draw in `[0, 1)`. */
export type MusicRandom = () => number;

/**
 * What a change of mood asks the player to do with the cue it is playing: nothing, cut over to the
 * next cue now, keep a cue that already fits (calling off a pending pass-end handover), hand over at
 * the next pass end, or, as a fight ends, at a pass end within {@link CALM_RETURN_MAX_WAIT_S}.
 */
export type MusicTransition = 'none' | 'now' | 'keep' | 'atPassEnd' | 'afterFight';

/** The frame's mood as the playlist reads it. */
export interface PlaylistMood {
  readonly intensity: MusicIntensity;
  readonly stance: DiplomacyState;
  readonly wealthy: boolean;
}

const CALM: PlaylistMood = { intensity: 'calm', stance: 'neutral', wealthy: false };

function randomInt(min: number, max: number, random: MusicRandom): number {
  return min + Math.floor(random() * (max - min + 1));
}

function shuffled<T>(items: readonly T[], random: MusicRandom): T[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = order[i];
    const b = order[j];
    if (a !== undefined && b !== undefined) {
      order[i] = b;
      order[j] = a;
    }
  }
  return order;
}

export class MusicPlaylist implements MusicSequence {
  private mood: PlaylistMood = CALM;
  /** Audio digest and mood of the last cue handed out. */
  private lastAudio: string | null = null;
  private lastIntensity: MusicIntensity = 'calm';
  /** A pass-end handover was asked for and the next cue has not been handed out yet. */
  private handoverPending = false;
  /** Each nation pool's shuffle bag: stems still to play this round, drawn from the end. */
  private readonly bags: Record<MusicIntensity, string[]> = { calm: [], tense: [] };
  /** Each nation pool's next stem, drawn ahead so the player can decode it: the tense one is what a
   *  fight cuts in on, the calm one what follows the playing calm cue. */
  private readonly ahead: Record<MusicIntensity, string | null> = { calm: null, tense: null };
  private readonly dropped = new Set<string>();

  constructor(
    readonly music: PlaylistMusic,
    private readonly manifest: MusicManifest,
    private readonly random: MusicRandom,
  ) {}

  /** Take the frame's mood and say how the playing cue should give way to it. */
  update(mood: PlaylistMood): MusicTransition {
    const previous = this.mood;
    this.mood = mood;
    return this.music.source === 'map' ? this.mapTransition(previous) : this.nationTransition(previous);
  }

  next(): MusicCue | null {
    this.handoverPending = false;
    if (this.music.source === 'map') {
      const stem = this.mapStem();
      if (stem === null) return null;
      return this.mood.intensity === 'tense'
        ? this.cue(stem, 'tense', MAP_PASSES, TENSE_FADE_IN_S, TENSE_FADE_S)
        : this.cue(stem, 'calm', MAP_PASSES, CALM_FADE_IN_S, CALM_FADE_S);
    }
    return (this.mood.intensity === 'tense' ? this.tenseCue() : null) ?? this.calmCue();
  }

  drop(file: string): void {
    this.dropped.add(file);
  }

  /** The stem a fight cuts in on, kept decoded so the cut-in does not wait on a fetch. */
  standby(): MusicTrack | null {
    return this.trackOf(this.music.source === 'map' ? this.mapTenseStem() : this.peek('tense'));
  }

  /** The stem the next cue plays in the current mood: the nation's next draw, or the map's stem
   *  once a mood change has moved it off the playing one. */
  upcoming(): MusicTrack | null {
    if (this.music.source === 'nation') return this.trackOf(this.peek(this.mood.intensity));
    const stem = this.mapStem();
    return stem === null || this.audioOf(stem) === this.lastAudio ? null : this.trackOf(stem);
  }

  private trackOf(stem: string | null): MusicTrack | null {
    return stem === null ? null : (this.manifest.tracks[stem] ?? null);
  }

  /** A map's stem changes when a fight starts or ends, or the standing picks another calm variant.
   *  A fight cuts in at once; anything else waits for the playing pass to end. */
  private mapTransition(previous: PlaylistMood): MusicTransition {
    const stem = this.mapStem();
    if (stem === null) return 'none';
    if (this.audioOf(stem) === this.lastAudio) {
      const pending = this.handoverPending;
      this.handoverPending = false;
      return pending ? 'keep' : 'none';
    }
    if (this.mood.intensity === 'tense' && previous.intensity === 'calm') return 'now';
    if (this.handoverPending) return 'none';
    this.handoverPending = true;
    return previous.intensity === 'tense' ? 'afterFight' : 'atPassEnd';
  }

  /** Only a turn between calm and tense moves the nation's music: a fight cuts in at once unless a
   *  tense cue still plays, calm waits for the pass end. */
  private nationTransition(previous: PlaylistMood): MusicTransition {
    if (this.mood.intensity === previous.intensity) return 'none';
    if (this.mood.intensity === 'calm') return this.lastIntensity === 'tense' ? 'afterFight' : 'none';
    if (this.lastIntensity === 'tense') return 'keep';
    return this.peek('tense') === null ? 'none' : 'now';
  }

  /** The map's stem for the mood: its tense stem in a fight when it authored one, else the calm
   *  variant for the standing, else any calm stem it rendered. */
  private mapStem(): string | null {
    if (this.music.source !== 'map') return null;
    const { variants } = this.music;
    const tense = this.mood.intensity === 'tense' ? this.mapTenseStem() : null;
    if (tense !== null) return tense;
    const preferred = ownCalmStem(variants, this.mood.stance, this.mood.wealthy);
    if (this.playable(preferred)) return preferred;
    const { calm, tense: tenseStems } = stemsByIntensity(variants);
    return [...calm, ...tenseStems].find((stem) => this.playable(stem)) ?? null;
  }

  private mapTenseStem(): string | null {
    if (this.music.source !== 'map') return null;
    const own = ownTenseStem(this.music.variants);
    return own !== null && this.playable(own) ? own : null;
  }

  /** The pool's next stem, drawn now if none is waiting or the waiting one was dropped. */
  private peek(intensity: MusicIntensity): string | null {
    const waiting = this.ahead[intensity];
    if (waiting === null || !this.playable(waiting)) this.ahead[intensity] = this.draw(intensity);
    return this.ahead[intensity];
  }

  private take(intensity: MusicIntensity): string | null {
    const stem = this.peek(intensity);
    this.ahead[intensity] = null;
    return stem;
  }

  private tenseCue(): MusicCue | null {
    const stem = this.take('tense');
    return stem === null ? null : this.cue(stem, 'tense', TENSE_PASSES, TENSE_FADE_IN_S, TENSE_FADE_S);
  }

  private calmCue(): MusicCue | null {
    const stem = this.take('calm');
    if (stem === null) return null;
    const passes = randomInt(CALM_PASSES_MIN, CALM_PASSES_MAX, this.random);
    return this.cue(stem, 'calm', passes, CALM_FADE_IN_S, CALM_FADE_S);
  }

  private cue(
    stem: string,
    intensity: MusicIntensity,
    passes: number,
    fadeInS: number,
    fadeS: number,
  ): MusicCue | null {
    const track = this.manifest.tracks[stem];
    if (track === undefined) return null;
    this.lastAudio = track.segmentSha256;
    this.lastIntensity = intensity;
    return { track, passes, gapBeforeS: CUE_GAP_S, fadeInS, fadeS };
  }

  /** The next stem from a nation pool's shuffle bag, never the last cue's audio when another is left;
   *  the bag refills reshuffled once it runs dry. */
  private draw(intensity: MusicIntensity): string | null {
    if (this.music.source !== 'nation') return null;
    const pool = this.music.pools[intensity].filter((stem) => this.playable(stem));
    if (pool.length === 0) return null;
    const fresh = (stem: string) => this.audioOf(stem) !== this.lastAudio;
    let bag = this.bags[intensity].filter((stem) => pool.includes(stem));
    if (!bag.some(fresh)) bag = shuffled(pool, this.random);
    let at = bag.length - 1;
    while (at > 0 && !fresh(bag[at] ?? '')) at--;
    const [stem] = bag.splice(at, 1);
    this.bags[intensity] = bag;
    return stem ?? null;
  }

  private playable(stem: string): boolean {
    const track = this.manifest.tracks[stem];
    return track !== undefined && !this.dropped.has(track.file);
  }

  private audioOf(stem: string): string | undefined {
    return this.manifest.tracks[stem]?.segmentSha256;
  }
}
