import { type Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { worldBatched } from '../world-batch/batcher.js';
import { ANCHOR_RING, STRING_OPEN } from './plan-stake.js';

/**
 * The marks of the berths under the dock cursor: a mooring post on the shore point each ship's door will
 * open on, a hemp line from it to the water where the hull will lie, and ripples there. The project's own
 * look after the wall tool's stake and string, tuned by eye; the original shows no such mark.
 */

/** The post's art: pixel art at the game's own scale, one art pixel per world px. */
const ART_WIDTH_PX = 17;
const ART_HEIGHT_PX = 28;
/** Where the post meets the ground and where the line is tied, as fractions of the art; whole art
 *  pixels, so the texels land on the world's pixel grid as the game's sprites do. */
const ART_GROUND = { x: 6 / ART_WIDTH_PX, y: 23 / ART_HEIGHT_PX } as const;
const ART_KNOT_Y = 12 / ART_HEIGHT_PX;
/** How far up the post the line ties on, in world px from the ground point. */
const POST_TIE_HEIGHT = Math.round((ART_GROUND.y - ART_KNOT_Y) * ART_HEIGHT_PX);

/** The line's sag below the straight run between its ends, per world px of that run, and at most. */
const LINE_SAG_PER_PX = 0.12;
const LINE_SAG_MAX = 14;
const LINE = { color: STRING_OPEN, width: 2, alpha: 1 } as const;
/** The line's dark underline, which keeps it readable over pale ground and bright water. */
const LINE_SHADOW = { color: 0x000000, width: 4, alpha: 0.35 } as const;
/** The ring on the ground around a post's foot, the line tools' start ring, so the post reads at a
 *  glance on any ground. */
const FOOT_RING = { color: ANCHOR_RING, rx: 11, ry: 5.5, width: 2, alpha: 0.95 } as const;

/** The ripples where a hull will lie: rings about the length and beam of a drawn ship, the outer one
 *  fainter, in the pale of breaking foam. */
const RIPPLES: readonly { readonly rx: number; readonly ry: number; readonly alpha: number }[] = [
  { rx: 84, ry: 36, alpha: 0.35 },
  { rx: 62, ry: 26, alpha: 0.6 },
  { rx: 40, ry: 16, alpha: 0.85 },
];
const RIPPLE = { color: 0xe8f4f0, width: 1.5 } as const;

/** Without the art (a bare render test, the `?shot` entry) a flat post of the same size stands in. */
const FALLBACK_WOOD = 0x6b4424;
const FALLBACK_BAND = 0x2b2b2b;
const FALLBACK_HALF_W = 4;
const FALLBACK_HEIGHT = 18;
const FALLBACK_BAND_Y = 15;

/** A berth's two screen points, lifted onto the ground: the door's on the shore, the hull's on the water. */
export interface BerthPoints {
  readonly door: { readonly x: number; readonly y: number };
  readonly hull: { readonly x: number; readonly y: number };
}

/** One post with its ground point at the display object's origin. */
function mintPost(art: Texture | undefined): Container {
  if (art !== undefined) {
    const sprite = worldBatched(new Sprite(art));
    sprite.anchor.set(ART_GROUND.x, ART_GROUND.y);
    sprite.scale.set(ART_HEIGHT_PX / sprite.texture.height);
    return sprite;
  }
  return new Graphics()
    .rect(-FALLBACK_HALF_W, -FALLBACK_HEIGHT, 2 * FALLBACK_HALF_W, FALLBACK_HEIGHT)
    .fill(FALLBACK_WOOD)
    .rect(-FALLBACK_HALF_W, -FALLBACK_BAND_Y, 2 * FALLBACK_HALF_W, 2)
    .fill(FALLBACK_BAND);
}

/** Add the marks of `berths` to `into`, each piece its own child, so the owner's teardown of its children
 *  frees them all. */
export function addBerthMarks(
  into: Container,
  post: Texture | undefined,
  berths: readonly BerthPoints[],
): void {
  const water = new Graphics();
  for (const { hull } of berths) {
    for (const ring of RIPPLES) {
      water
        .ellipse(hull.x, hull.y, ring.rx, ring.ry)
        .stroke({ color: RIPPLE.color, width: RIPPLE.width, alpha: ring.alpha });
    }
  }
  // Each line runs from its post's knot to the hull's middle, sagging like a slack hawser.
  const lines = new Graphics();
  for (const { door, hull } of berths) {
    const knot = { x: door.x, y: door.y - POST_TIE_HEIGHT };
    const sag = Math.min(LINE_SAG_MAX, Math.hypot(hull.x - knot.x, hull.y - knot.y) * LINE_SAG_PER_PX);
    const bend = { x: (knot.x + hull.x) / 2, y: (knot.y + hull.y) / 2 + sag };
    for (const stroke of [LINE_SHADOW, LINE]) {
      lines.moveTo(knot.x, knot.y).quadraticCurveTo(bend.x, bend.y, hull.x, hull.y).stroke(stroke);
    }
  }
  const rings = new Graphics();
  for (const { door } of berths) {
    rings
      .ellipse(door.x, door.y, FOOT_RING.rx, FOOT_RING.ry)
      .stroke({ color: FOOT_RING.color, width: FOOT_RING.width, alpha: FOOT_RING.alpha });
  }
  into.addChild(water, rings, lines);
  // Back to front, so a nearer post covers the one behind it.
  for (const { door } of [...berths].sort((a, b) => a.door.y - b.door.y)) {
    const mark = mintPost(post);
    mark.position.set(door.x, door.y);
    into.addChild(mark);
  }
}
