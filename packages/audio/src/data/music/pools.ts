import { MUSIC_VARIANTS, type MusicVariants } from './catalog.js';
import type { MusicManifest } from './manifest.js';

/**
 * A nation's music: every stem of every map code its culture authored, split into a calm and a tense
 * pool. The nation soundtrack is a design choice of this reimplementation: the original plays one
 * segment per map and only switches its mood.
 */

/** A playable nation's music culture: the families the segment names group into. */
export type MusicCulture = 'norse' | 'frank' | 'byzantine' | 'arab';

/** Whether a stem fits a quiet stretch or a fight. */
export type MusicIntensity = 'calm' | 'tense';

/** The words segment stems use for each culture, digits stripped (`viking1` reads as `viking`). The
 *  Underworld stem belongs to no playable nation and stays out of every pool. */
const CULTURE_BY_STEM_WORD: Readonly<Record<string, MusicCulture>> = {
  viking: 'norse',
  midgard: 'norse',
  nordland: 'norse',
  asgard: 'norse',
  franken: 'frank',
  byzanz: 'byzantine',
  arabs: 'arab',
};

/** Tribe slug to the culture whose music it plays. Egypt authored no music; the Arab score is its
 *  nearest kin, the way it borrows Saracen voices. Approximation. */
const CULTURE_BY_TRIBE: Readonly<Record<string, MusicCulture>> = {
  viking: 'norse',
  frank: 'frank',
  byzantine: 'byzantine',
  saracen: 'arab',
  egypt: 'arab',
};

/** A culture's interchangeable stems, each distinct audio, in stem order. */
export interface MusicPools {
  readonly calm: readonly string[];
  readonly tense: readonly string[];
}

/** The culture a stem's words name, or null for a stem outside every nation. */
export function cultureOfStem(stem: string): MusicCulture | null {
  for (const word of stem.split('_')) {
    const culture = CULTURE_BY_STEM_WORD[word.replace(/\d+$/, '')];
    if (culture !== undefined) return culture;
  }
  return null;
}

/** The culture a tribe slug plays, or null for a tribe with no nation music (beasts, monsters). */
export function cultureOfTribe(slug: string): MusicCulture | null {
  return CULTURE_BY_TRIBE[slug] ?? null;
}

/** A code's stems by intensity. A stem a code repeats in a tense slot (a mission with no Danger
 *  segment) stays calm only. */
export function stemsByIntensity(
  variants: MusicVariants,
): Readonly<Record<MusicIntensity, readonly string[]>> {
  switch (variants.family) {
    case 'attack':
      return { calm: [], tense: [variants.stem] };
    case 'theme': {
      const { friendly, neutral, hostile } = variants.stems;
      const calm = [friendly, neutral];
      return { calm, tense: calm.includes(hostile) ? [] : [hostile] };
    }
    case 'mission': {
      const { standard, wealthy, danger } = variants.stems;
      const calm = [standard, wealthy];
      return { calm, tense: calm.includes(danger) ? [] : [danger] };
    }
  }
}

/** `stems` sorted, rendered, and folded to one stem per distinct audio. */
function distinctRendered(stems: Iterable<string>, manifest: MusicManifest): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const stem of [...new Set(stems)].sort()) {
    const track = manifest.tracks[stem];
    if (track === undefined || seen.has(track.segmentSha256)) continue;
    seen.add(track.segmentSha256);
    kept.push(stem);
  }
  return kept;
}

/** Each culture's pools of rendered stems. */
export function culturePools(manifest: MusicManifest): ReadonlyMap<MusicCulture, MusicPools> {
  const gathered = new Map<MusicCulture, { calm: string[]; tense: string[] }>();
  for (const variants of Object.values(MUSIC_VARIANTS)) {
    const { calm, tense } = stemsByIntensity(variants);
    const culture = cultureOfStem(calm[0] ?? tense[0] ?? '');
    if (culture === null) continue;
    const pools = gathered.get(culture) ?? { calm: [], tense: [] };
    pools.calm.push(...calm);
    pools.tense.push(...tense);
    gathered.set(culture, pools);
  }
  const pools = new Map<MusicCulture, MusicPools>();
  for (const [culture, { calm, tense }] of gathered) {
    const calmPool = distinctRendered(calm, manifest);
    // A stem that is the same audio as a calm one stays calm.
    const calmAudio = new Set(calmPool.map((stem) => manifest.tracks[stem]?.segmentSha256));
    const tensePool = distinctRendered(tense, manifest).filter(
      (stem) => !calmAudio.has(manifest.tracks[stem]?.segmentSha256),
    );
    pools.set(culture, { calm: calmPool, tense: tensePool });
  }
  return pools;
}

/** The stems a map's `musictype` authored, or null when the code names no segment or none was rendered. */
export function mapVariantsFor(musicType: number | null, manifest: MusicManifest): MusicVariants | null {
  if (musicType === null) return null;
  const variants = MUSIC_VARIANTS[musicType];
  if (variants === undefined) return null;
  const { calm, tense } = stemsByIntensity(variants);
  return [...calm, ...tense].some((stem) => manifest.tracks[stem] !== undefined) ? variants : null;
}
