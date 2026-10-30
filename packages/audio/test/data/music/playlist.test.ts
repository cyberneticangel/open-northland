import { describe, expect, it } from 'vitest';
import {
  CALM_FADE_IN_S,
  CALM_PASSES_MAX,
  CALM_PASSES_MIN,
  CUE_GAP_S,
  choosePlaylistMusic,
  culturePools,
  MAP_PASSES,
  type MusicCue,
  type MusicManifest,
  MusicPlaylist,
  type MusicPools,
  type MusicRandom,
  mapVariantsFor,
  type PlaylistMood,
  parseMusicManifest,
  TENSE_FADE_IN_S,
  TENSE_PASSES,
} from '../../../src/index.js';
import { manifestDocument, musicTrack } from '../../support/music-manifest.js';

/**
 * The two soundtracks: a map's own stem looped unbroken and switched by mood, and a nation's stems
 * shuffled back to back with its tense stems for a fight. Every draw comes from the injected source,
 * so a seed pins it.
 */

const THEME_VIKING = 2;
const ATTACK_VIKING = 6;
const MISSION_FRANKEN1 = 11;
const MISSION_MIDGARD1 = 20;
const SEED = 7;
const LONG_RUN = 200;

/** mulberry32: a small seeded uniform source, standing in for the browser's `Math.random`. */
function seeded(seed: number): MusicRandom {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** The Frank and Norse segments the cases need; the add-on Franken2 stems repeat Franken1's audio. */
const STEMS = [
  'mission_franken1_standard',
  'mission_franken1_wealthy',
  'mission_franken1_danger',
  'mission_franken2_standard',
  'mission_franken2_wealthy',
  'mission_franken2_danger',
  'mission_addon_franken1_standard',
  'theme_franken_friendly',
  'theme_franken_neutral',
  'theme_franken_hostile',
  'attack_franken',
  'mission_midgard1_standard',
  'theme_viking_friendly',
  'theme_viking_neutral',
  'theme_viking_hostile',
  'mission_midgard2_standard',
  'mission_viking1_danger',
  'attack_viking',
  'mission_addon_nordland_standard',
  'mission_addon_asgard_standard',
  'mission_addon_underworld_standard',
];
const ADDON_FRANKEN2 = ['standard', 'wealthy', 'danger'].map((mood) => [
  `mission_addon_franken2_${mood}`,
  `mission_franken1_${mood}`,
]);

function fixture(): MusicManifest {
  const tracks = Object.fromEntries([
    ...STEMS.map((stem) => [stem, musicTrack(stem)]),
    ...ADDON_FRANKEN2.map(([addon = '', base = '']) => [addon, musicTrack(addon, { sameAudioAs: base })]),
  ]);
  const { manifest } = parseMusicManifest(manifestDocument(tracks));
  if (manifest === null) throw new Error('the fixture manifest must parse');
  return manifest;
}
const MANIFEST = fixture();

const CALM: PlaylistMood = { intensity: 'calm', stance: 'neutral', wealthy: false };
const TENSE: PlaylistMood = { ...CALM, intensity: 'tense' };

const FRANK = culturePools(MANIFEST).get('frank') as MusicPools;
const NORSE = culturePools(MANIFEST).get('norse') as MusicPools;

function mapPlaylist(musicType: number): MusicPlaylist {
  const variants = mapVariantsFor(musicType, MANIFEST);
  if (variants === null) throw new Error(`no music for ${musicType}`);
  return new MusicPlaylist({ source: 'map', variants }, MANIFEST, seeded(SEED));
}

function nationPlaylist(pools: MusicPools, random: MusicRandom = seeded(SEED)): MusicPlaylist {
  return new MusicPlaylist({ source: 'nation', pools }, MANIFEST, random);
}

function take(playlist: MusicPlaylist, count: number): MusicCue[] {
  const taken: MusicCue[] = [];
  for (let i = 0; i < count; i++) {
    const cue = playlist.next();
    if (cue === null) break;
    taken.push(cue);
  }
  return taken;
}

const stemOf = (cue: MusicCue): string => cue.track.file.replace(/\.ogg$/, '');

describe('choosing the music', () => {
  const variants = mapVariantsFor(MISSION_FRANKEN1, MANIFEST);

  it('plays the source asked for when it has music', () => {
    expect(choosePlaylistMusic('map', variants, FRANK)?.source).toBe('map');
    expect(choosePlaylistMusic('nation', variants, FRANK)?.source).toBe('nation');
  });

  it('falls back to the nation for a map without music and to the map for a seat without a nation', () => {
    expect(choosePlaylistMusic('map', null, FRANK)?.source).toBe('nation');
    expect(choosePlaylistMusic('nation', variants, null)?.source).toBe('map');
    expect(choosePlaylistMusic('nation', variants, { calm: [], tense: [] })?.source).toBe('map');
    expect(choosePlaylistMusic('map', null, null)).toBeNull();
  });
});

describe('map music', () => {
  it('loops the map’s own stem unbroken, cue after cue', () => {
    const cues = take(mapPlaylist(MISSION_FRANKEN1), 3);
    expect(cues.map(stemOf)).toEqual(Array(3).fill('mission_franken1_standard'));
    expect(cues[0]).toMatchObject({ passes: MAP_PASSES, gapBeforeS: CUE_GAP_S, fadeInS: CALM_FADE_IN_S });
  });

  it('cuts to the Danger stem at once and returns to Standard at a pass end', () => {
    const playlist = mapPlaylist(MISSION_FRANKEN1);
    take(playlist, 1);
    expect(playlist.update(CALM)).toBe('none');
    expect(playlist.update(TENSE)).toBe('now');
    expect(take(playlist, 1).map(stemOf)).toEqual(['mission_franken1_danger']);
    expect(playlist.update(TENSE)).toBe('none');
    expect(playlist.update(CALM)).toBe('afterFight');
    expect(playlist.update(TENSE)).toBe('keep');
    expect(playlist.update(CALM)).toBe('afterFight');
    expect(take(playlist, 1).map(stemOf)).toEqual(['mission_franken1_standard']);
  });

  it('follows the standing into the Wealthy stem at a pass end', () => {
    const playlist = mapPlaylist(MISSION_FRANKEN1);
    take(playlist, 1);
    expect(playlist.update({ ...CALM, wealthy: true })).toBe('atPassEnd');
    expect(playlist.update({ ...CALM, wealthy: true })).toBe('none');
    expect(playlist.upcoming()?.file).toBe('mission_franken1_wealthy.ogg');
    expect(take(playlist, 1).map(stemOf)).toEqual(['mission_franken1_wealthy']);
  });

  it('follows a theme’s stance and stays on the hostile stem when a fight starts against an enemy', () => {
    const playlist = mapPlaylist(THEME_VIKING);
    playlist.update({ ...CALM, stance: 'enemy' });
    expect(take(playlist, 1).map(stemOf)).toEqual(['theme_viking_hostile']);
    expect(playlist.update({ ...TENSE, stance: 'enemy' })).toBe('none');
  });

  it('keeps a map with no Danger segment on its own stem through a fight', () => {
    const playlist = mapPlaylist(MISSION_MIDGARD1);
    take(playlist, 1);
    expect(playlist.update(TENSE)).toBe('none');
    expect(take(playlist, 1).map(stemOf)).toEqual(['mission_midgard1_standard']);
    expect(playlist.standby()).toBeNull();
  });

  it('plays an attack code’s one stem whatever the mood', () => {
    const playlist = mapPlaylist(ATTACK_VIKING);
    expect(take(playlist, 1).map(stemOf)).toEqual(['attack_viking']);
    expect(playlist.update(TENSE)).toBe('none');
  });

  it('stands by with the Danger stem', () => {
    expect(mapPlaylist(MISSION_FRANKEN1).standby()?.file).toBe('mission_franken1_danger.ogg');
  });

  it('ends once its only stem is dropped', () => {
    const playlist = mapPlaylist(MISSION_MIDGARD1);
    playlist.drop('mission_midgard1_standard.ogg');
    expect(playlist.next()).toBeNull();
  });
});

describe('nation music', () => {
  it('plays every calm stem of the nation back to back, one or two passes each', () => {
    const cues = take(nationPlaylist(FRANK), LONG_RUN);
    expect(cues).toHaveLength(LONG_RUN);
    for (const cue of cues) {
      expect(cue.gapBeforeS).toBe(CUE_GAP_S);
      expect(cue.passes).toBeGreaterThanOrEqual(CALM_PASSES_MIN);
      expect(cue.passes).toBeLessThanOrEqual(CALM_PASSES_MAX);
    }
    expect(new Set(cues.map(stemOf))).toEqual(new Set(FRANK.calm));
  });

  it('never plays the same audio twice in a row', () => {
    const cues = take(nationPlaylist(FRANK), LONG_RUN);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]?.track.segmentSha256).not.toBe(cues[i - 1]?.track.segmentSha256);
    }
  });

  it('opens a fight on its standby, holds tense stems for several passes and calms at a pass end', () => {
    const playlist = nationPlaylist(NORSE);
    take(playlist, 1);
    const opener = playlist.standby();
    expect(playlist.update(TENSE)).toBe('now');
    const [first, second] = take(playlist, 2);
    expect(first?.track).toEqual(opener);
    expect(first).toMatchObject({ passes: TENSE_PASSES, fadeInS: TENSE_FADE_IN_S });
    expect(NORSE.tense).toContain(stemOf(second as MusicCue));
    expect(second?.track.segmentSha256).not.toBe(first?.track.segmentSha256);
    expect(playlist.update(CALM)).toBe('afterFight');
    // The calm cue that follows the fight is named ahead, for the player to decode before the handover.
    expect(NORSE.calm.map((stem) => `${stem}.ogg`)).toContain(playlist.upcoming()?.file);
    expect(playlist.update(TENSE)).toBe('keep');
    playlist.update(CALM);
    expect(NORSE.calm).toContain(stemOf(take(playlist, 1)[0] as MusicCue));
  });

  it('names the next calm cue ahead, so the player can decode it before the handover', () => {
    const playlist = nationPlaylist(FRANK);
    take(playlist, 1);
    for (let i = 0; i < LONG_RUN; i++) {
      const upcoming = playlist.upcoming();
      expect(take(playlist, 1)[0]?.track).toEqual(upcoming);
    }
    const looping = mapPlaylist(MISSION_FRANKEN1);
    take(looping, 1);
    expect(looping.upcoming()).toBeNull();
  });

  it('opens on the current fight when a rebuilt playlist is told the mood first', () => {
    const playlist = nationPlaylist(NORSE);
    playlist.update(TENSE);
    expect(NORSE.tense).toContain(stemOf(take(playlist, 1)[0] as MusicCue));
  });

  it('stays calm through a fight when the nation has no tense stem', () => {
    const playlist = nationPlaylist({ calm: NORSE.calm, tense: [] });
    take(playlist, 1);
    expect(playlist.update(TENSE)).toBe('none');
  });

  it('never offers a dropped file again and ends once every stem is gone', () => {
    const playlist = nationPlaylist(NORSE);
    const [dropped, ...kept] = NORSE.calm;
    playlist.drop(`${dropped}.ogg`);
    expect(new Set(take(playlist, LONG_RUN).map(stemOf)).has(dropped ?? '')).toBe(false);
    for (const stem of kept) playlist.drop(`${stem}.ogg`);
    expect(playlist.next()).toBeNull();
  });
});
