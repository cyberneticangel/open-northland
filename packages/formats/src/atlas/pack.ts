/**
 * Bob atlas packer: a decoded `.bmd` bob set into one RGBA sheet plus a per-bob frame manifest. A
 * `.bmd` carries no animation grouping (that lives in the `setatomic` `.ini` bindings), so the manifest
 * is one entry per bob id, with a 0×0 rect for an empty bob so every id stays addressable.
 */

import { type Bmd, type BobFrame, decodeBobFrame } from '../bmd/index.js';
import type { RgbaImage } from '../image.js';
import {
  type AtlasAlphaMode,
  type BobBake,
  colouredBake,
  INDEXED_BAKE,
  indexedBake,
  indexedToDisplacement,
  SHADOW_BAKE,
  writeIndexedPixel,
} from './bake.js';

/** Transparent gutter (in pixels) left between packed frames so sampling can't bleed across them. */
export const ATLAS_GUTTER = 1;

/** Default atlas width the shelf packer wraps at; frames wider than this still fit (they get their own row). */
const DEFAULT_ATLAS_MAX_WIDTH = 1024;
const ALPHA_CHANNEL = 3;

/** One frame's placement + metadata in the atlas. Plain JSON data - no typed arrays or class instances. */
export interface AtlasFrame {
  /** The bob's stable id: `bmd.firstBobId + index`. */
  readonly bobId: number;
  /** Raw bob `type` (0 empty / 1 8-bit / 2 1-bit mask / 3 TimeMask / 4 double-byte). Carried, not interpreted. */
  readonly type: number;
  /** Pixel rect of this frame inside the atlas. `width`/`height` are 0 for an empty/zero-size bob. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** The bob's draw offset from the `.bmd` (`SBobData.Area`), added to the sprite's screen anchor. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** True if the frame wrote at least one visible pixel (an all-transparent or empty frame is `false`). */
  readonly opaque: boolean;
}

/** The JSON manifest emitted alongside the atlas sheet: atlas dimensions + one entry per bob, in id order. */
export interface AtlasManifest {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly AtlasFrame[];
}

/** A packed atlas: the RGBA sheet to encode plus its manifest to write as JSON. */
export interface BobAtlas {
  readonly image: RgbaImage;
  readonly manifest: AtlasManifest;
  /** The `'build-time'` bake's second sheet: grayscale build-progress thresholds, placed like {@link image}. */
  readonly timeImage?: RgbaImage;
}

export interface PackBobAtlasOptions {
  /** Shelf-packer wrap width (default {@link DEFAULT_ATLAS_MAX_WIDTH}). */
  readonly maxWidth?: number;
  /** Alpha bake mode (default `'per-pixel'` - see {@link AtlasAlphaMode}). */
  readonly alpha?: AtlasAlphaMode;
  /** Bob ids that bake `'per-pixel'` whatever {@link alpha} says: the decor a build-time `.bmd` also
   *  carries, whose second byte is coverage. */
  readonly coverageBobs?: ReadonlySet<number>;
  /** Rewrites a decoded frame's pixels in place before it is baked. */
  readonly editFrame?: FrameEdit;
}

/** An in-place edit of bob `bobId`'s decoded frame. */
export type FrameEdit = (bobId: number, frame: BobFrame) => void;

const NO_BOBS: ReadonlySet<number> = new Set();

/**
 * Packs every bob of a decoded `.bmd` into one atlas, colouring frames with `palette`. The result's
 * `manifest.frames` has exactly `bmd.bobCount` entries, in bob-id order, so a consumer can address any
 * bob id. A frame wider than `maxWidth` is still packed; its row is just wider.
 */
export function packBobAtlas(bmd: Bmd, palette: Uint8Array, options: PackBobAtlasOptions = {}): BobAtlas {
  const {
    maxWidth = DEFAULT_ATLAS_MAX_WIDTH,
    alpha = 'per-pixel',
    coverageBobs = NO_BOBS,
    editFrame,
  } = options;
  const atlasBake = colouredBake(palette, alpha);
  const coverageBake = alpha === 'per-pixel' ? atlasBake : colouredBake(palette, 'per-pixel');
  return packBobAtlasWith(
    bmd,
    (bobId) => (coverageBobs.has(bobId) ? coverageBake : atlasBake),
    maxWidth,
    editFrame,
  );
}

/**
 * Packs a shadow `.bmd` (`GfxBobLibs` `shadowlib`: 1-bit silhouettes paralleling the body bob ids) into
 * pre-baked black-at-`SHADOW_ALPHA` silhouettes, so a cast shadow draws as a plain batched sprite.
 */
export function packShadowBobAtlas(bmd: Bmd): BobAtlas {
  return packBobAtlasWith(bmd, () => SHADOW_BAKE, DEFAULT_ATLAS_MAX_WIDTH);
}

/**
 * Packs every bob into an indexed atlas (the opaque layout of `expandBobFrameIndexed`; the gutters are
 * uncovered pixels too). Placement, manifest and time sheet are identical to the RGB atlas
 * {@link packBobAtlas} makes of the same `.bmd` with the same options, so colouring this sheet through a
 * palette yields that atlas's sheet. Coverage bakes graded, like the RGB path, so the type-4 bobs'
 * authored feathered translucency survives into the drawn sprite.
 */
export function packIndexedBobAtlas(bmd: Bmd, options: PackBobAtlasOptions = {}): BobAtlas {
  const {
    maxWidth = DEFAULT_ATLAS_MAX_WIDTH,
    alpha = 'per-pixel',
    coverageBobs = NO_BOBS,
    editFrame,
  } = options;
  const atlasBake = indexedBake(alpha);
  const atlas = packBobAtlasWith(
    bmd,
    (bobId) => (coverageBobs.has(bobId) ? INDEXED_BAKE : atlasBake),
    maxWidth,
    editFrame,
  );
  const { rgba } = atlas.image;
  // The packer leaves the space between frames all zero; the layout's uncovered pixel is opaque.
  for (let o = 0; o < rgba.length; o += 4) {
    if (rgba[o + ALPHA_CHANNEL] === 0) writeIndexedPixel(rgba, o, 0, 0);
  }
  return atlas;
}

/**
 * Packs a displacement `.bmd` (a `GfxUserFXMatrix` effect, whose pixel bytes are values, not colours)
 * with {@link packIndexedBobAtlas}'s placement, in the layout of `indexedToDisplacement`.
 */
export function packDisplacementBobAtlas(bmd: Bmd): BobAtlas {
  const atlas = packIndexedBobAtlas(bmd);
  return { ...atlas, image: indexedToDisplacement(atlas.image) };
}

/** The bake one bob id takes. */
type BakeFor = (bobId: number) => BobBake;

function packBobAtlasWith(bmd: Bmd, bakeFor: BakeFor, maxWidth: number, editFrame?: FrameEdit): BobAtlas {
  const prepared = prepareFrames(bmd, bakeFor, editFrame);
  const layout = shelfPack(prepared, maxWidth);
  return emitAtlas(
    prepared,
    layout,
    prepared.some((p) => p.buildTime),
  );
}

/** A frame's pre-packing record: its baked pixels (or `undefined` if 0×0) plus the metadata to emit. */
interface PreparedFrame {
  readonly bobId: number;
  readonly type: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly image: RgbaImage | undefined;
  /** The frame's build-progress plane, same size as {@link image}. */
  readonly timeImage: RgbaImage | undefined;
  /** Whether the frame took a `'time'` bake, which puts a time sheet beside the atlas. */
  readonly buildTime: boolean;
  readonly opaque: boolean;
}

/** `bobs` is `bobCount` long by the {@link Bmd} contract, so the index guard only discharges the
 *  checked-index `| undefined`. */
function prepareFrames(bmd: Bmd, bakeFor: BakeFor, editFrame: FrameEdit | undefined): PreparedFrame[] {
  const prepared: PreparedFrame[] = [];
  for (let i = 0; i < bmd.bobCount; i++) {
    const bob = bmd.bobs[i];
    if (bob === undefined) continue;
    const bobId = bmd.firstBobId + i;
    const bake = bakeFor(bobId);
    const frame = decodeBobFrame(bmd, i, bake.secondByte);
    editFrame?.(bobId, frame);
    const hasPixels = frame.width > 0 && frame.height > 0;
    let opaque = false;
    if (hasPixels) {
      for (let m = 0; m < frame.mask.length; m++) {
        if (frame.mask[m] !== 0) {
          opaque = true;
          break;
        }
      }
    }
    prepared.push({
      bobId,
      type: bob.type,
      offsetX: bob.area.x,
      offsetY: bob.area.y,
      width: frame.width,
      height: frame.height,
      image: hasPixels ? bake.plane(frame) : undefined,
      timeImage: hasPixels && bake.secondByte === 'time' ? bake.time(frame) : undefined,
      buildTime: bake.secondByte === 'time',
      opaque,
    });
  }
  return prepared;
}

/** Where each frame lands and the sheet size that holds them (min 1×1 so an empty pack is a valid image). */
interface PackedLayout {
  /** Placement per non-empty frame, keyed by its index in the `prepared` array (not its bob id). */
  readonly placements: ReadonlyMap<number, { readonly x: number; readonly y: number }>;
  readonly width: number;
  readonly height: number;
}

/** Shelf-packs the non-empty frames left to right into rows wrapping at `maxWidth`, in bob-id order so
 *  the layout stays deterministic. */
function shelfPack(prepared: readonly PreparedFrame[], maxWidth: number): PackedLayout {
  const placements = new Map<number, { x: number; y: number }>();
  let cursorX = ATLAS_GUTTER;
  let cursorY = ATLAS_GUTTER;
  let rowHeight = 0;
  let atlasWidth = 0;
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    if (p === undefined || p.image === undefined) continue;
    // Wrap to a new shelf on overflow, but always place at least one frame per row.
    if (cursorX > ATLAS_GUTTER && cursorX + p.width + ATLAS_GUTTER > maxWidth) {
      cursorX = ATLAS_GUTTER;
      cursorY += rowHeight + ATLAS_GUTTER;
      rowHeight = 0;
    }
    placements.set(i, { x: cursorX, y: cursorY });
    cursorX += p.width + ATLAS_GUTTER;
    if (cursorX > atlasWidth) atlasWidth = cursorX;
    if (p.height > rowHeight) rowHeight = p.height;
  }
  const atlasHeight = rowHeight === 0 ? cursorY : cursorY + rowHeight + ATLAS_GUTTER;
  return { placements, width: Math.max(1, atlasWidth), height: Math.max(1, atlasHeight) };
}

/** Blits a source RGBA image into `dst` at (`dx`,`dy`). Caller guarantees the source fits inside `dst`. */
function blit(dst: RgbaImage, src: RgbaImage, dx: number, dy: number): void {
  const dstStride = dst.width * 4;
  const srcStride = src.width * 4;
  for (let y = 0; y < src.height; y++) {
    const from = y * srcStride;
    const to = (dy + y) * dstStride + dx * 4;
    dst.rgba.set(src.rgba.subarray(from, from + srcStride), to);
  }
}

/** Allocates the sheet(s), blits each placed frame, and builds the manifest the packer returns. */
function emitAtlas(
  prepared: readonly PreparedFrame[],
  layout: PackedLayout,
  withTimeSheet: boolean,
): BobAtlas {
  const { placements, width, height } = layout;
  const image: RgbaImage = { width, height, rgba: new Uint8Array(width * height * 4) };
  const timeImage: RgbaImage | undefined = withTimeSheet
    ? { width, height, rgba: new Uint8Array(width * height * 4) }
    : undefined;

  const frames: AtlasFrame[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    if (p === undefined) continue;
    const at = placements.get(i);
    if (p.image !== undefined && at !== undefined) {
      blit(image, p.image, at.x, at.y);
      if (timeImage !== undefined && p.timeImage !== undefined) blit(timeImage, p.timeImage, at.x, at.y);
      frames.push({
        bobId: p.bobId,
        type: p.type,
        rect: { x: at.x, y: at.y, width: p.width, height: p.height },
        offsetX: p.offsetX,
        offsetY: p.offsetY,
        opaque: p.opaque,
      });
    } else {
      frames.push({
        bobId: p.bobId,
        type: p.type,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        offsetX: p.offsetX,
        offsetY: p.offsetY,
        opaque: false,
      });
    }
  }

  const manifest = { width, height, frames };
  return timeImage === undefined ? { image, manifest } : { image, manifest, timeImage };
}
