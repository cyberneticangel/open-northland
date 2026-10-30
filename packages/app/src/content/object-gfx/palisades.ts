import type { LayeredBobRef, PalisadeBinding } from '@open-northland/render';
import { PLAYER_COLOR_COUNT } from '../../catalog/roster.js';
import { playerPaletteAtlasStem, servedAtlasStem } from '../ir/joins.js';
import type { ContentIr, LandscapeGfxRow } from '../ir/rows.js';
import { playerWallRows, WALL_LOGIC_ID } from '../map/palisade-rows.js';
import { firstBobsByStateAscending } from '../resource-gfx/refs.js';

/** The source landscape rows used by walls and their open/closed gate variants. */
export interface PalisadeGfxRefs {
  readonly records: readonly PalisadeRecordRef[];
  /** Only ordinary post variants participate in the repeated-post cycle. */
  readonly wallVariantOrder: readonly number[];
}

interface PalisadeRecordRef {
  readonly gfxIndex: number;
  readonly stem: string;
  /** The record's bob baked through each team colour's palette, indexed by colour slot: the original
   *  draws an owned wall in its owner's palette. */
  readonly playerStems: readonly string[];
  readonly bobs: readonly number[];
}

/**
 * Resolve the original wall family by logic-table identity. This keeps the join data-driven while retaining
 * every authored gate orientation and state in the same atlas binding.
 */
export function resolvePalisadeGfxRefs(ir: ContentIr | null): PalisadeGfxRefs {
  const walls = playerWallRows(ir);
  const records: PalisadeRecordRef[] = [];
  const wallVariantOrder: number[] = [];
  for (const record of ir?.landscapeGfx ?? []) {
    const logicId = walls.get(record.logicType)?.logicId;
    if (logicId === undefined) continue;
    const ref = palisadeRecordRef(record);
    if (ref === undefined) continue;
    records.push(ref);
    if (logicId === WALL_LOGIC_ID && record.editName?.startsWith('wall_0') === true)
      wallVariantOrder.push(record.index);
  }
  return { records, wallVariantOrder };
}

function palisadeRecordRef(record: LandscapeGfxRow): PalisadeRecordRef | undefined {
  const stem = servedAtlasStem(record);
  const bobs = firstBobsByStateAscending(record);
  if (stem === undefined || bobs === undefined || record.bmd === undefined) return undefined;
  const bmd = record.bmd;
  const playerStems = Array.from({ length: PLAYER_COLOR_COUNT }, (_, p) => playerPaletteAtlasStem(bmd, p));
  return { gfxIndex: record.index, stem, playerStems, bobs };
}

export function palisadeAtlasStems(refs: PalisadeGfxRefs): ReadonlySet<string> {
  return new Set(refs.records.flatMap((record) => [record.stem, ...record.playerStems]));
}

/** Build the layer-qualified post/gate table after the referenced atlas families have loaded. */
export function buildPalisadeBinding(
  refs: PalisadeGfxRefs,
  loaded: ReadonlySet<string>,
): PalisadeBinding | undefined {
  const byGfxIndex: Record<number, readonly LayeredBobRef[]> = {};
  for (const record of refs.records) {
    if (!loaded.has(record.stem)) continue;
    byGfxIndex[record.gfxIndex] = record.bobs.map((bob) => ({ layer: record.stem, bob }));
  }
  const first = refs.records.find((record) => byGfxIndex[record.gfxIndex] !== undefined);
  if (first === undefined) return undefined;
  const frames = byGfxIndex[first.gfxIndex];
  const fallback = frames?.at(-1);
  if (fallback === undefined) return undefined;
  const byPlayer = Array.from({ length: PLAYER_COLOR_COUNT }, (_, p) => playerFrames(refs, loaded, p));
  return {
    byGfxIndex,
    ...(byPlayer.some((frames) => frames !== undefined) ? { byPlayer } : {}),
    variantOrder: refs.wallVariantOrder.filter((gfxIndex) => byGfxIndex[gfxIndex] !== undefined),
    default: fallback,
  };
}

/** Team colour `player`'s frames by record index, or `undefined` when none of its bakes loaded. */
function playerFrames(
  refs: PalisadeGfxRefs,
  loaded: ReadonlySet<string>,
  player: number,
): Readonly<Record<number, readonly LayeredBobRef[]>> | undefined {
  const byGfxIndex: Record<number, readonly LayeredBobRef[]> = {};
  let any = false;
  for (const record of refs.records) {
    const stem = record.playerStems[player];
    if (stem === undefined || !loaded.has(stem)) continue;
    byGfxIndex[record.gfxIndex] = record.bobs.map((bob) => ({ layer: stem, bob }));
    any = true;
  }
  return any ? byGfxIndex : undefined;
}
