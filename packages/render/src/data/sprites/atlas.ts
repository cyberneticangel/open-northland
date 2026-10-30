import type { BobAtlasManifest, BobAtlasStem } from '@open-northland/data';

/** Authored ground marker in frame-local source pixels, independent of image padding. */
export interface SelectionEllipse {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

export interface AtlasFrame {
  /** Pixel rect of the frame inside the atlas sheet (top-left origin). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Source draw offset, added to the sprite's feet-anchor screen position. */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly selectionEllipse?: SelectionEllipse;
  /** Radians the paletted mesh turns the frame clockwise about its bottom-centre, a head about its neck. */
  readonly tilt?: number;
}

export interface SpriteAtlas {
  readonly width: number;
  readonly height: number;
  readonly frames: ReadonlyMap<number, AtlasFrame>;
}

/** A missing frame and a 0x0 frame (an empty bob) are both absent. */
export function lookupFrame(atlas: SpriteAtlas, id: number): AtlasFrame | null {
  const frame = atlas.frames.get(id);
  return frame === undefined || frame.width === 0 || frame.height === 0 ? null : frame;
}

export function indexAtlasFrames(
  width: number,
  height: number,
  manifestFrames: readonly {
    readonly bobId: number;
    readonly rect: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    readonly offsetX: number;
    readonly offsetY: number;
  }[],
): SpriteAtlas {
  const frames = new Map<number, AtlasFrame>();
  for (const f of manifestFrames) {
    frames.set(f.bobId, {
      x: f.rect.x,
      y: f.rect.y,
      width: f.rect.width,
      height: f.rect.height,
      offsetX: f.offsetX,
      offsetY: f.offsetY,
    });
  }
  return { width, height, frames };
}

/**
 * How a paletted sheet is stored, as the atlas document names it: `index-coverage-png` is an 8-bit
 * grey + alpha PNG (colour type 4), the palette index in grey and the coverage in alpha. The app decodes
 * it in JavaScript: a browser image decode premultiplies a covered pixel's index away, and some
 * browsers alter canvas reads.
 */
export type AtlasImageEncoding = NonNullable<BobAtlasStem['imageEncoding']>;

/** One stem's manifest, decoded from `bobs/atlases.json`. Image names are file names under `bobs/`;
 *  stems with byte-identical sheets name the same file. */
export type AtlasManifest = BobAtlasManifest;

/**
 * CPU-side copy of a build-time sheet: row-major 0-255 per-pixel thresholds at atlas
 * coordinates, where a pixel appears once construction progress reaches its threshold. Values at
 * transparent atlas pixels are meaningless.
 */
export interface BuildTimeSheet {
  readonly width: number;
  readonly height: number;
  /** The sheet's R channel, `width * height` bytes. */
  readonly values: Uint8Array;
}

const timedFrames = new WeakMap<BuildTimeSheet, WeakMap<AtlasFrame, boolean>>();

/**
 * Whether a frame's region of the time sheet holds any nonzero threshold. Some mod sheets are zero
 * under every pixel of a construction stage, which carries no reveal order and would draw the whole
 * stage at 0% progress, so such a frame reveals as if it had no time data.
 */
export function frameHasBuildTimes(times: BuildTimeSheet, frame: AtlasFrame): boolean {
  let byFrame = timedFrames.get(times);
  if (byFrame === undefined) {
    byFrame = new WeakMap();
    timedFrames.set(times, byFrame);
  }
  let timed = byFrame.get(frame);
  if (timed === undefined) {
    timed = false;
    for (let y = frame.y; y < frame.y + frame.height && !timed; y++) {
      const row = y * times.width;
      for (let x = frame.x; x < frame.x + frame.width; x++) {
        if ((times.values[row + x] ?? 0) !== 0) {
          timed = true;
          break;
        }
      }
    }
    byFrame.set(frame, timed);
  }
  return timed;
}
