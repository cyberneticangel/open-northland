import {
  forgetShaderLinks,
  type ShaderWarmup,
  startBackgroundShaderWarmup,
  startShaderWarmup,
  type WarmedProgram,
  type WarmupSettings,
} from '@open-northland/render';
import { diag } from '../../diag/log.js';
import { readStoredSettings } from '../settings/store.js';

/** The warm-up for the settings last asked about; a change of a setting that picks programs starts
 *  another, which shares the programs the two have in common. A warm-up that stopped waiting for a
 *  stalled driver is waited on afresh by the next caller rather than taken as done. */
let current: { readonly key: string; readonly warmup: ShaderWarmup; stalled: boolean } | null = null;

function settingsKey(settings: WarmupSettings): string {
  return [
    settings.enhancedSampling,
    settings.pixelArtScaler,
    settings.softShadows,
    settings.environmentMotion,
    settings.weather,
    settings.blood,
  ].join('/');
}

function sharedWarmup<W extends ShaderWarmup | null>(
  start: (settings: WarmupSettings) => W,
): ShaderWarmup | W {
  const settings = readStoredSettings();
  const key = settingsKey(settings);
  if (current?.key === key && !current.stalled) return current.warmup;
  const startedAt = performance.now();
  const warmup = start(settings);
  if (warmup === null) return warmup;
  const entry = { key, warmup, stalled: false };
  current = entry;
  void warmup.done.then((programs) => {
    // A superseded warm-up still finishes, but its report belongs to settings no longer in use.
    if (current !== entry) return;
    logWarmup(programs, performance.now() - startedAt);
    entry.stalled = programs.some((program) => program.outcome === 'pending');
  });
  return warmup;
}

function logWarmup(programs: readonly WarmedProgram[], ms: number): void {
  const named = (outcome: WarmedProgram['outcome']): string[] =>
    programs.filter((program) => program.outcome === outcome).map((program) => program.name);
  diag.info('boot', 'shaders warmed', {
    ms: Math.round(ms),
    programs: programs.map((program) => `${program.name} ${program.outcome} ${Math.round(program.ms)} ms`),
  });
  const failed = named('failed');
  if (failed.length > 0) diag.warn('boot', 'shaders failed to link in the warm-up', { failed });
  const pending = named('pending');
  if (pending.length > 0)
    diag.warn('boot', 'shader warm-up stopped waiting for a stalled driver', { pending });
}

/**
 * The warm-up of the graphics programs the stored settings select, for a map boot to wait on behind its
 * loading card. It takes over a background warm-up of the same settings, so a map opened from the menu
 * usually finds its programs linked.
 */
export function graphicsShaderWarmup(): ShaderWarmup {
  return sharedWarmup(startShaderWarmup);
}

/** The warm-up again, every program linked anew, for a game canvas whose WebGL context came back: a
 *  restarted GPU process kept none of the programs the earlier warm-ups linked. */
export function rewarmAfterContextRestore(): ShaderWarmup {
  forgetShaderLinks();
  current = null;
  return graphicsShaderWarmup();
}

/** Starts the warm-up while the menu stays interactive; where links would block the menu's thread it
 *  leaves them to the map's loading card. */
export function warmGraphicsInBackground(): void {
  try {
    sharedWarmup(startBackgroundShaderWarmup);
  } catch (err) {
    // An optimisation must not take the menu down; the map boot tries again behind its card.
    diag.error('boot', 'background shader warm-up failed to start', err);
  }
}

/** Resolves once the warm-up for the stored settings settles, following any warm-up that a later
 *  settings change started in place of the one awaited. A stalled warm-up counts as settled, so a
 *  stalled driver is not waited on twice. */
async function settingsWarmed(): Promise<void> {
  try {
    for (;;) {
      const warmup = graphicsShaderWarmup();
      await warmup.done;
      if (current?.warmup === warmup) return;
    }
  } catch (err) {
    // The change still applies: the renderer links what it needs itself.
    diag.error('boot', 'shader warm-up for a live change failed to start', err);
  }
}

/**
 * `apply` for a live graphics change, run once the programs the stored settings now pick are linked:
 * the renderer's own link of a program it had no use for blocks the frame it happens in, seconds on
 * Direct3D. A change `needsPrograms` says draws nothing new applies at once. A change that another
 * supersedes before its programs link is dropped.
 */
export function applyWhenWarmed<T>(
  apply: (next: T) => void,
  needsPrograms: (next: T) => boolean = () => true,
): (next: T) => void {
  let revision = 0;
  return (next) => {
    const mine = ++revision;
    if (!needsPrograms(next)) {
      apply(next);
      return;
    }
    void settingsWarmed().then(() => {
      if (mine === revision) apply(next);
    });
  };
}
