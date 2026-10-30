import { type BobSequenceSet, CARRIED_LOAD_BAND } from '@open-northland/data';
import type { FrameEdit } from '@open-northland/formats/atlas/index';
import { type Bmd, type BobFrame, decodeBobFrame } from '@open-northland/formats/bmd/index';

const BAND_SHIFT = 4;
const BAND_COLOURS = 16;
/** Packs a frame-space point into one number; bob offsets and sizes stay far inside this span. */
const POINT_SPAN = 1 << 16;
const POINT_ORIGIN = POINT_SPAN / 2;

const bandOf = (index: number): number => index >> BAND_SHIFT;
const pointKey = (x: number, y: number): number => (y + POINT_ORIGIN) * POINT_SPAN + x + POINT_ORIGIN;

/** `data/engine2d/bin/bobs/cr_hum_body_10_variant5.bmd` → `cr_hum_body_10_variant5.bmd`. */
const basename = (bmd: string): string => bmd.slice(bmd.lastIndexOf('/') + 1).toLowerCase();

/**
 * The edit that moves a woman's carried load out of her dress band ({@link CARRIED_LOAD_BAND}), or
 * undefined for a sheet of another body. A carry frame's load pixels are its dress-band pixels where the
 * plain walk's same frame, anchored alike, draws no dress. Throws when the body's sheet has no plain or
 * carry walk, a walk reaches past the sheet, a carry walk's length differs from the plain walk's, or the
 * sheet already draws in the load band: the sheet would ship with the load left in the team colour.
 */
export function carriedLoadBandEdit(
  bmdPath: string,
  bmd: Bmd,
  sequenceSets: readonly BobSequenceSet[],
): FrameEdit | undefined {
  const name = basename(bmdPath);
  const { body, plainWalk, fromBand, band } = CARRIED_LOAD_BAND;
  if (name.replace(/(_variant\d+)?\.bmd$/, '') !== body) return undefined;
  const fail = (reason: string): never => {
    throw new Error(`carried load band: ${name} ${reason}`);
  };
  const sequences = sequenceSets.find((set) => basename(set.imagelib) === name)?.sequences ?? [];
  const inSheet = (start: number, length: number): boolean =>
    start >= bmd.firstBobId && start + length <= bmd.firstBobId + bmd.bobs.length;
  const plain = sequences.find((seq) => seq.name === plainWalk) ?? fail(`has no ${plainWalk}`);
  if (!inSheet(plain.start, plain.length)) fail(`${plainWalk} reaches past the sheet`);
  for (let i = 0; i < bmd.bobs.length; i++) {
    const { pixels, mask } = decodeBobFrame(bmd, i);
    for (let p = 0; p < pixels.length; p++) {
      if (mask[p] !== 0 && bandOf(pixels[p] ?? 0) === band) {
        fail(`already draws in band ${band}`);
      }
    }
  }
  // Carry bob id → the plain walk's bob id drawing the same body frame.
  const plainOf = new Map<number, number>();
  for (const seq of sequences) {
    if (!seq.name.startsWith(`${plainWalk}_`)) continue;
    if (seq.length !== plain.length)
      fail(`${seq.name} has ${seq.length} frames, ${plainWalk} ${plain.length}`);
    if (!inSheet(seq.start, seq.length)) fail(`${seq.name} reaches past the sheet`);
    for (let k = 0; k < seq.length; k++) plainOf.set(seq.start + k, plain.start + k);
  }
  if (plainOf.size === 0) fail(`has no ${plainWalk}_<good> carry walk`);
  const dressPoints = (bobId: number): Set<number> => {
    const index = bobId - bmd.firstBobId;
    const frame = decodeBobFrame(bmd, index);
    const points = new Set<number>();
    const area = bmd.bobs[index]?.area;
    if (area === undefined) return points;
    forEachBandPixel(frame, fromBand, (x, y) => points.add(pointKey(x + area.x, y + area.y)));
    return points;
  };
  return (bobId, frame) => {
    const plainId = plainOf.get(bobId);
    const area = bmd.bobs[bobId - bmd.firstBobId]?.area;
    if (plainId === undefined || area === undefined) return;
    const dress = dressPoints(plainId);
    forEachBandPixel(frame, fromBand, (x, y, p) => {
      if (dress.has(pointKey(x + area.x, y + area.y))) return;
      frame.pixels[p] = band * BAND_COLOURS + ((frame.pixels[p] ?? 0) % BAND_COLOURS);
    });
  };
}

function forEachBandPixel(
  frame: BobFrame,
  band: number,
  visit: (x: number, y: number, p: number) => void,
): void {
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const p = y * frame.width + x;
      if (frame.mask[p] !== 0 && bandOf(frame.pixels[p] ?? 0) === band) visit(x, y, p);
    }
  }
}
