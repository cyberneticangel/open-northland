import { readFile } from 'node:fs/promises';
import type { BobSequenceSet, LandscapeGfx, LandscapeType } from '@open-northland/data';
import { packIndexedBobAtlas } from '@open-northland/formats/atlas/index';
import { type Bmd, decodeBmd } from '@open-northland/formats/bmd/index';
import { type BmdPaletteBinding, normalizeAssetPath } from '@open-northland/formats/ini';
import { decodePcx } from '@open-northland/formats/pcx';
import {
  PLAYER_COLORS,
  type PlayerColorDef,
  synthesizePlayerSource,
} from '@open-northland/formats/player-palette';
import { errorMessage } from '../errors.js';
import { carriedLoadBandEdit } from './bmd/load-band.js';
import { type BobAtlasCatalog, INDEXED_ATLAS_SUFFIX, writeSourceBobAtlas } from './content-tree.js';
import type { SourceAssetIndex } from './source-files.js';

/** Directory holding the creature `.pcx` palettes, the `playerNN.pcx` player colours among them. */
const CREATURES_DIR = 'Data/engine2d/bin/palettes/creatures';
/** The reference palette the synthetic (no-original) player colours are toned from. */
const SYNTHETIC_REFERENCE_PCX = 'player01.pcx';
/** Human character bobs get the recolourable indexed atlas; everything else keeps its baked RGB atlas. */
const CHARACTER_BMD_RE = /(^|\/)cr_hum_/i;
/** Whether `bmd` is a human character body or head, which the app draws from its indexed atlas. */
export function isCharacterBmd(bmd: string): boolean {
  return CHARACTER_BMD_RE.test(bmd);
}

/** The guidepost bob. Its board-text indices 23-30 sit inside the `playerNN.pcx` player ramp and those
 *  palettes carry the wood ramp at indices 131-141, so the original draws it through the player's own
 *  full palette. */
const GUIDEPOST_BMD = 'data/engine2d/bin/bobs/ls_guidepost.bmd';

/**
 * The bobs the original draws through their owner's full `playerNN.pcx` palette: the guidepost, and every
 * landscape record whose logic row is `playeridallowed` (the walls and gates). Original behavior: an owned
 * landscape object takes its owner's palette in place of its own `GfxPalette`, so a wall's lashings
 * (indices 16-31, the player ramp) show the owner's colour.
 */
export function ownerPaletteBmds(ir: {
  readonly landscape: readonly Pick<LandscapeType, 'typeId' | 'playerIdAllowed'>[];
  readonly landscapeGfx: readonly Pick<LandscapeGfx, 'logicType' | 'bmd'>[];
}): string[] {
  const owned = new Set(ir.landscape.filter((row) => row.playerIdAllowed).map((row) => row.typeId));
  const bmds = new Set([GUIDEPOST_BMD]);
  for (const record of ir.landscapeGfx) {
    if (owned.has(record.logicType) && record.bmd !== undefined) bmds.add(normalizeAssetPath(record.bmd));
  }
  return [...bmds];
}

/** The building signs and flags; `landscapes.cif` binds its player records to `human_Player01..10` only. */
const SIGN_BMD = 'data/engine2d/bin/bobs/ls_temp.bmd';

/**
 * Reads a `creatures/<file>.pcx` 768-byte trailer palette from the layer that wins it. Throws when the
 * file is in no layer or carries no palette trailer.
 */
async function readCreaturePalette(tree: SourceAssetIndex, file: string): Promise<Uint8Array> {
  const source = tree.get(normalizeAssetPath(`${CREATURES_DIR}/${file}`));
  if (source === undefined) throw new Error(`player-colors: ${file} not found in any source layer`);
  const pal = decodePcx(await readFile(source.path)).palette;
  if (pal === undefined) throw new Error(`player-colors: ${file} has no 256-colour palette trailer`);
  return pal;
}

/**
 * Writes one atlas per player (`<bmd-basename>.player_NN`) for each of `bmds`: the shared indexed sheet
 * coloured through that player's full source palette. Returns how many atlases it wrote. A missing or
 * unreadable `.bmd` is skipped with a warning.
 */
export async function convertPlayerPaletteAtlases(
  bmds: readonly string[],
  atlases: BobAtlasCatalog,
  tree: SourceAssetIndex,
): Promise<number> {
  const reference = await readCreaturePalette(tree, SYNTHETIC_REFERENCE_PCX);
  const palettes = await Promise.all(
    PLAYER_COLORS.map((color) => playerSourcePalette(tree, reference, color)),
  );
  let emitted = 0;
  for (const bmdRef of bmds) {
    const source = tree.get(normalizeAssetPath(bmdRef));
    if (source === undefined) {
      console.warn(`[pipeline] skipped player atlases of ${bmdRef}: not found in any source layer`);
      continue;
    }
    try {
      const indexed = packIndexedBobAtlas(decodeBmd(await readFile(source.path)));
      for (const [at, color] of PLAYER_COLORS.entries()) {
        const palette = palettes[at];
        if (palette === undefined) continue;
        // The `player_NN` suffix is a string contract with the app's `playerPaletteAtlasStem`.
        const suffix = `player_${String(color.id).padStart(2, '0')}`;
        await writeSourceBobAtlas(atlases, source.rel, suffix, { indexed, palette });
        emitted++;
      }
    } catch (err) {
      console.warn(`[pipeline] skipped player atlases of ${bmdRef}: ${errorMessage(err)}`);
    }
  }
  return emitted;
}

/**
 * Writes the sign atlas of each synthetic player colour under the stem the original's own palettes
 * would give it (`ls_temp.human_playerNN`, one-based), toned from player 0's palette. The app reads
 * it with player 0's sign records, the frames every player's records share.
 */
export async function convertSignPlayerAtlases(
  atlases: BobAtlasCatalog,
  tree: SourceAssetIndex,
): Promise<number> {
  const source = tree.get(normalizeAssetPath(SIGN_BMD));
  if (source === undefined) throw new Error('sign atlases: ls_temp.bmd not found in any source layer');
  const indexed = packIndexedBobAtlas(decodeBmd(await readFile(source.path)));
  const reference = await readCreaturePalette(tree, SYNTHETIC_REFERENCE_PCX);
  const synthetic = PLAYER_COLORS.filter((color) => color.source.kind === 'synthetic');
  for (const color of synthetic) {
    const suffix = `human_player${String(color.id + 1).padStart(2, '0')}`;
    await writeSourceBobAtlas(atlases, source.rel, suffix, {
      indexed,
      palette: await playerSourcePalette(tree, reference, color),
    });
  }
  return synthetic.length;
}

/** A colour's full source palette: its shipped `playerNN.pcx`, or `reference` toned to it. */
async function playerSourcePalette(
  tree: SourceAssetIndex,
  reference: Uint8Array,
  color: PlayerColorDef,
): Promise<Uint8Array> {
  return color.source.kind === 'pcx'
    ? readCreaturePalette(tree, color.source.file)
    : synthesizePlayerSource(reference, color.source);
}

/**
 * Emits an indexed atlas (`<bmd-basename>.indexed`) for every human character `.bmd`
 * in `bindings`, deduped because many bindings share one body. A missing or malformed `.bmd` is skipped
 * with a warning. `sequenceSets` (the IR's `bobSequences`) pair a woman's carry walks for
 * {@link carriedLoadBandEdit}.
 */
export async function convertIndexedCharacterAtlases(
  bindings: readonly BmdPaletteBinding[],
  atlases: BobAtlasCatalog,
  tree: SourceAssetIndex,
  sequenceSets: readonly BobSequenceSet[],
): Promise<string[]> {
  const characterBmds = new Set<string>();
  for (const b of bindings) {
    if (isCharacterBmd(b.bmd) && /\.bmd$/i.test(b.bmd)) characterBmds.add(b.bmd);
  }
  const done: string[] = [];
  for (const bmdRef of characterBmds) {
    const source = tree.get(bmdRef);
    if (source === undefined) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: not found in any source layer`);
      continue;
    }
    let bmd: Bmd;
    try {
      bmd = decodeBmd(await readFile(source.path));
    } catch (err) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: ${errorMessage(err)}`);
      continue;
    }
    // Outside the per-file guard: a sheet that no longer pairs its carry walks fails the run.
    const editFrame = carriedLoadBandEdit(bmdRef, bmd, sequenceSets);
    try {
      const atlas = packIndexedBobAtlas(bmd, editFrame === undefined ? {} : { editFrame });
      const { image } = await writeSourceBobAtlas(atlases, source.rel, INDEXED_ATLAS_SUFFIX, atlas);
      done.push(image);
    } catch (err) {
      console.warn(`[pipeline] skipped indexed ${bmdRef}: ${errorMessage(err)}`);
    }
  }
  return done;
}
