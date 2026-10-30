import { describe, expect, it } from 'vitest';
import {
  cultureOfStem,
  cultureOfTribe,
  culturePools,
  MUSIC_VARIANTS,
  mapVariantsFor,
  parseMusicManifest,
} from '../../../src/index.js';
import { manifestDocument, musicTrack } from '../../support/music-manifest.js';

/**
 * The nation pools: every rendered stem lands in its culture's calm or tense pool, each distinct
 * audio once. The fixture is the full segment table, with the
 * twelve add-on stems that ship the same segment bytes as a base mission.
 */

const MISSION_MIDGARD1 = 20;
const JINGLE_BIRTH = 23;

/** Add-on stem to the base stem whose segment bytes it repeats. */
const SAME_AUDIO: Readonly<Record<string, string>> = Object.fromEntries(
  [
    ['addon_arabs1', 'arabs1'],
    ['addon_arabs2', 'arabs3'],
    ['addon_franken2', 'franken1'],
    ['addon_franken3', 'franken2'],
  ].flatMap(([addon, base]) =>
    ['standard', 'wealthy', 'danger'].map((mood) => [`mission_${addon}_${mood}`, `mission_${base}_${mood}`]),
  ),
);

function everyStem(): string[] {
  const stems = new Set<string>();
  for (const variants of Object.values(MUSIC_VARIANTS)) {
    if (variants.family === 'attack') stems.add(variants.stem);
    else for (const stem of Object.values(variants.stems)) stems.add(stem);
  }
  return [...stems];
}

const MANIFEST = parseMusicManifest(
  manifestDocument(
    Object.fromEntries(
      everyStem().map((stem) => {
        const sameAudioAs = SAME_AUDIO[stem];
        return [stem, musicTrack(stem, { ...(sameAudioAs === undefined ? {} : { sameAudioAs }) })];
      }),
    ),
  ),
).manifest;

if (MANIFEST === null) throw new Error('the fixture manifest must parse');
const POOLS = culturePools(MANIFEST);

describe('music culture', () => {
  it('reads the culture off the stem words, campaign digits and all', () => {
    expect(cultureOfStem('mission_midgard2_standard')).toBe('norse');
    expect(cultureOfStem('mission_addon_asgard_standard')).toBe('norse');
    expect(cultureOfStem('theme_franken_hostile')).toBe('frank');
    expect(cultureOfStem('attack_byzanz')).toBe('byzantine');
    expect(cultureOfStem('mission_addon_arabs2_wealthy')).toBe('arab');
    expect(cultureOfStem('mission_addon_underworld_standard')).toBeNull();
    expect(cultureOfStem('jingles_birth')).toBeNull();
  });
});

describe('culture pools', () => {
  it('never holds two stems of the same audio in one culture', () => {
    for (const { calm, tense } of POOLS.values()) {
      const digests = [...calm, ...tense].map((stem) => MANIFEST.tracks[stem]?.segmentSha256);
      expect(new Set(digests).size).toBe(digests.length);
    }
  });

  it('keeps a mission that authored only Standard out of the tense pool', () => {
    expect(POOLS.get('norse')?.calm).toContain('mission_midgard1_standard');
    expect(POOLS.get('norse')?.tense).not.toContain('mission_midgard1_standard');
  });

  it('leaves out a stem the pipeline did not render', () => {
    const { mission_viking1_danger: _missing, ...rest } = MANIFEST.tracks;
    expect(culturePools({ tracks: rest }).get('norse')?.tense).not.toContain('mission_viking1_danger');
  });
});

describe('nation and map lookups', () => {
  it('maps each nation to its culture and leaves the beasts out', () => {
    expect(cultureOfTribe('viking')).toBe('norse');
    expect(cultureOfTribe('saracen')).toBe('arab');
    expect(cultureOfTribe('egypt')).toBe('arab');
    expect(cultureOfTribe('wolves')).toBeNull();
  });

  it('gives a map code its own stems, and none for a jingle, an unknown or a missing code', () => {
    expect(mapVariantsFor(MISSION_MIDGARD1, MANIFEST)).toEqual(MUSIC_VARIANTS[MISSION_MIDGARD1]);
    expect(mapVariantsFor(JINGLE_BIRTH, MANIFEST)).toBeNull();
    expect(mapVariantsFor(999, MANIFEST)).toBeNull();
    expect(mapVariantsFor(null, MANIFEST)).toBeNull();
    expect(mapVariantsFor(MISSION_MIDGARD1, { tracks: {} })).toBeNull();
  });
});
