import { NIGHT_FALL_BAND } from '../world-batch/shader.js';
import type { PooledEntity } from './pooled-entity.js';

/** A share is drawn in steps of this, so a fade repacks a bearer's quads only when its light shows a
 *  step brighter or darker. */
const SHARE_STEPS = 64;

/**
 * The night's light-bearers marked on their own body layers (see `lighting/night-mask.ts`): each layer
 * draws its share of the lit mask in the same draw as its colour, so the painter's order covers it
 * where anything stands in front. A frame marks the bearers it lights between {@link begin} and
 * {@link end}; a bearer it skipped goes back to unlit.
 */
export class NightBearers {
  private readonly lit = new Set<PooledEntity>();
  private readonly touched = new Set<PooledEntity>();

  begin(): void {
    this.touched.clear();
  }

  /** Mark `pe` lit at `share` of the mask, over its whole body or fading toward its top (`fall`). */
  mark(pe: PooledEntity, share: number, fall: boolean): void {
    this.touched.add(pe);
    this.lit.add(pe);
    const stepped = Math.round(share * SHARE_STEPS) / SHARE_STEPS;
    const packed = stepped === 0 ? 0 : fall ? NIGHT_FALL_BAND + stepped : stepped;
    paint(pe, packed);
  }

  /** Return every bearer this frame did not mark to unlit; one the pool destroyed is only forgotten. */
  end(): void {
    for (const pe of this.lit) {
      if (this.touched.has(pe)) continue;
      if (!pe.container.destroyed) paint(pe, 0);
      this.lit.delete(pe);
    }
  }

  clear(): void {
    this.lit.clear();
    this.touched.clear();
  }
}

/** Write `packed` on `pe`'s body layers; a plain entity's shadow and ground cover stay unlit. */
function paint(pe: PooledEntity, packed: number): void {
  for (let i = 0; i < pe.sprites.length; i++) {
    const body = pe.sprites[i];
    if (body === undefined) continue;
    body.nightLit = !pe.paletted && pe.pickExempt[i] === true ? 0 : packed;
  }
}
