import { LIGHT_LOOKS, type LightSiteList } from '../../data/lighting/light-sites.js';
import { screenToCell, type Viewport } from '../../data/projection/index.js';
import type { MapObjectSprite } from './map-object-sprite.js';

/** A fire's pool reaches this far past its anchor, world px: one just off screen still lights its edge. */
const LIGHT_REACH_PX = LIGHT_LOOKS.fire.radius;
/** A fire's flicker seed packs its rounded x into the low bits and y above them. */
const SEED_Y_SHIFT = 16;
/** A block key is `by * BLOCK_ROW_STRIDE + bx`; no map is this many blocks wide. */
const BLOCK_ROW_STRIDE = 1 << 16;

/** A burning object with what a frame reads of it, worked out once when it is added. */
interface Burning {
  readonly obj: MapObjectSprite;
  readonly col: number;
  readonly row: number;
  readonly seed: number;
}

/** The map's burning objects in square blocks of world px, so a frame reads only the blocks on screen. */
export class ObjectLightIndex {
  private readonly blocks = new Map<number, Map<MapObjectSprite, Burning>>();

  constructor(private readonly blockPx: number) {}

  add(obj: MapObjectSprite): void {
    if (obj.light === undefined) return;
    const key = this.keyAt(obj.x, obj.y);
    let block = this.blocks.get(key);
    if (block === undefined) {
      block = new Map();
      this.blocks.set(key, block);
    }
    const { col, row } = screenToCell(obj.x, obj.y);
    const seed = Math.round(obj.x) ^ (Math.round(obj.y) << SEED_Y_SHIFT);
    block.set(obj, { obj, col, row, seed });
  }

  remove(obj: MapObjectSprite): void {
    if (obj.light === undefined) return;
    this.blocks.get(this.keyAt(obj.x, obj.y))?.delete(obj);
  }

  clear(): void {
    this.blocks.clear();
  }

  /** Append the lights within reach of `vp` to `out`, those on ground the viewer has explored when
   *  `explored` gates it. */
  collect(vp: Viewport, out: LightSiteList, explored?: (tileX: number, tileY: number) => boolean): void {
    if (this.blocks.size === 0) return;
    const minBX = Math.floor((vp.minX - LIGHT_REACH_PX) / this.blockPx);
    const maxBX = Math.floor((vp.maxX + LIGHT_REACH_PX) / this.blockPx);
    const minBY = Math.floor((vp.minY - LIGHT_REACH_PX) / this.blockPx);
    const maxBY = Math.floor((vp.maxY + LIGHT_REACH_PX) / this.blockPx);
    for (let by = minBY; by <= maxBY; by++) {
      for (let bx = minBX; bx <= maxBX; bx++) {
        const block = this.blocks.get(by * BLOCK_ROW_STRIDE + bx);
        if (block === undefined) continue;
        for (const { obj, col, row, seed } of block.values()) {
          if (obj.light === undefined || (explored !== undefined && !explored(col, row))) continue;
          out.push(obj.light, seed, obj.x, obj.y - (obj.lift ?? 0));
        }
      }
    }
  }

  private keyAt(x: number, y: number): number {
    return Math.floor(y / this.blockPx) * BLOCK_ROW_STRIDE + Math.floor(x / this.blockPx);
  }
}
