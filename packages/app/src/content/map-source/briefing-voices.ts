import {
  NARRATION_IDLE,
  type NarrationRate,
  type NarrationState,
  type SoundDriver,
} from '@open-northland/audio';
import type { BriefingVoice } from '@open-northland/data';
import { diag } from '../../diag/log.js';
import type { ContentFetch } from '../url.js';
import { mapFilePath, voiceFileSuffix } from './files.js';
import { findMapSource, type MapSource } from './sources.js';

/** A map's briefing clips: which it ships, and each one's wav bytes, or null when it ships none. */
export interface BriefingVoiceLoader {
  has(voice: BriefingVoice): boolean;
  load(voice: BriefingVoice): Promise<Uint8Array | null>;
}

/** Where a narration line plays: the sound driver's narration transport. */
export type NarrationSink = Pick<
  SoundDriver,
  | 'narrate'
  | 'narrationAvailable'
  | 'pauseNarration'
  | 'resumeNarration'
  | 'seekNarration'
  | 'stopNarration'
  | 'narrationState'
  | 'setNarrationRate'
>;

const SILENT: BriefingVoiceLoader = { has: () => false, load: async () => null };

/** `mapId`'s briefing voices: only the clips its listing declares, so a map that ships none asks for
 *  nothing. A map awaiting a rebuild or download has none. */
export async function mapBriefingVoices(
  mapId: string | null,
  find: (mapId: string) => Promise<MapSource | null> = findMapSource,
): Promise<BriefingVoiceLoader> {
  if (mapId === null) return SILENT;
  const source = await find(mapId);
  if (source === null || source.stale) return SILENT;
  return declaredVoices(source.entry.id, source.entry.voices ?? [], source.fetch);
}

/** Loads the `declared` clips through `files`, each at most once per world. */
function declaredVoices(
  mapId: string,
  declared: readonly string[],
  files: ContentFetch,
): BriefingVoiceLoader {
  const listed = new Set(declared);
  const clips = new Map<string, Promise<Uint8Array | null>>();
  return {
    has: (voice) => listed.has(voiceFileSuffix(voice)),
    load(voice) {
      const suffix = voiceFileSuffix(voice);
      if (!listed.has(suffix)) return Promise.resolve(null);
      let clip = clips.get(suffix);
      if (clip === undefined) {
        clip = loadClip(mapFilePath(mapId, suffix), files);
        clips.set(suffix, clip);
      }
      return clip;
    },
  };
}

async function loadClip(path: string, files: ContentFetch): Promise<Uint8Array | null> {
  try {
    const response = await files(path);
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    diag.warn('content', 'briefing voice missing', { path, status: response.status });
    return null;
  } catch (error) {
    diag.warn('content', 'briefing voice unreadable', { path, error: String(error) });
    return null;
  }
}

const sameVoice = (a: BriefingVoice, b: BriefingVoice): boolean => a.lang === b.lang && a.id === b.id;

/** The clip the player stands on: its bytes once loaded, and a pause pressed while it still loads. */
interface Line {
  readonly voice: BriefingVoice;
  wav: Uint8Array | null;
  pauseOnLoad: boolean;
}

/** Speaks one clip at a time into `sink` at `rate`: a clip that loads after a later play or a stop stays
 *  silent. A clip that does not load or that the sink refuses stays unavailable for the world. */
export function briefingVoicePlayer(
  voices: BriefingVoiceLoader,
  sink: NarrationSink,
  rate: NarrationRate = 1,
  onRateChange: (rate: NarrationRate) => void = () => {},
) {
  let tempo = rate;
  sink.setNarrationRate(tempo);
  let turn = 0;
  let current: Line | null = null;
  const refused = new Set<string>();

  const refuse = (line: Line): void => {
    refused.add(voiceFileSuffix(line.voice));
    if (current === line) current = null;
  };
  const narrate = (line: Line, wav: Uint8Array, paused: boolean): void => {
    if (!sink.narrate(wav, { paused })) refuse(line);
  };

  const start = (voice: BriefingVoice): void => {
    const mine = ++turn;
    sink.stopNarration();
    if (refused.has(voiceFileSuffix(voice))) {
      current = null;
      return;
    }
    const line: Line = { voice, wav: null, pauseOnLoad: false };
    current = line;
    void voices
      .load(voice)
      .then((wav) => {
        if (mine !== turn) return;
        if (wav === null) {
          refuse(line);
          return;
        }
        line.wav = wav;
        narrate(line, wav, line.pauseOnLoad);
      })
      .catch((error: unknown) => {
        refuse(line);
        diag.warn('content', 'briefing voice unplayable', { error: String(error) });
      });
  };

  return {
    has: (voice: BriefingVoice): boolean => voices.has(voice),
    /** Sound is on and `voice`'s clip has not failed to load or play. */
    available: (voice: BriefingVoice): boolean =>
      sink.narrationAvailable() && !refused.has(voiceFileSuffix(voice)),
    play: start,
    stop(): void {
      turn++;
      current = null;
      sink.stopNarration();
    },
    toggle(voice: BriefingVoice): void {
      if (current === null || !sameVoice(current.voice, voice)) {
        start(voice);
        return;
      }
      if (current.wav === null) {
        current.pauseOnLoad = !current.pauseOnLoad;
        return;
      }
      const { status } = sink.narrationState();
      if (status === 'playing' || status === 'waiting') sink.pauseNarration();
      else if (status === 'idle') narrate(current, current.wav, false);
      else sink.resumeNarration();
    },
    seek(voice: BriefingVoice, atS: number): void {
      if (current !== null && sameVoice(current.voice, voice) && current.wav !== null)
        sink.seekNarration(atS);
    },
    rate: (): NarrationRate => tempo,
    setRate(next: NarrationRate): void {
      if (next === tempo) return;
      tempo = next;
      sink.setNarrationRate(next);
      onRateChange(next);
    },
    state(): NarrationState & { readonly voice: BriefingVoice | null } {
      if (current === null) return { voice: null, ...NARRATION_IDLE };
      if (current.wav === null)
        return {
          voice: current.voice,
          status: current.pauseOnLoad ? 'paused' : 'waiting',
          positionS: 0,
          durationS: 0,
        };
      return { voice: current.voice, ...sink.narrationState() };
    },
  };
}
