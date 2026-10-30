import { Container, Graphics, type Renderer, RenderTexture, Sprite } from 'pixi.js';
import {
  halfCellToScreenX,
  halfCellToScreenY,
  nodeDiamondPoly,
  TILE_HALF_H,
  TILE_HALF_W,
} from '../../data/projection/index.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';
import { hashCells } from './cell-signature.js';

/**
 * The build-placement overlay: a translucent dark wash over everything the held building cannot anchor
 * on and a slight lift over the ground it can, with no visible tile grid. The sim's placement rule
 * (`Simulation.placementProbe`) decides the blocked set; this layer only projects it. Each side is
 * composited off-screen at half resolution first, where the padded diamonds fuse by saturating instead
 * of double-blending. The alpha and softness constants are tuned by eye against the original's
 * build-mode look (observation).
 */

/** One half-cell node of the probed band (integer col,row on the `2W×2H` lattice). */
export interface PlacementOverlayCell {
  readonly col: number;
  readonly row: number;
}

/** One build-mode frame: the probed node band, plus which of its nodes rejected the held building's
 *  anchor - `reserved` where the ground is kept for a standing building's upgrade, `blocked` otherwise.
 *  The two are disjoint; the buildable side is the rest of the band. */
export interface PlacementOverlayFrame {
  readonly minCol: number;
  readonly maxCol: number;
  readonly minRow: number;
  readonly maxRow: number;
  readonly blocked: readonly PlacementOverlayCell[];
  readonly reserved: readonly PlacementOverlayCell[];
  /** How the open side's edge is drawn: node diamonds (the default), or `round`, a soft ground ellipse
   *  per open node that a thin band, such as the shore a ship moors at, reads as one rounded strip. */
  readonly brush?: OverlayBrush;
}

export type OverlayBrush = 'diamond' | 'round';

/** The dim wash: near-black at a moderate alpha - enough to read "blocked" without hiding the ground. */
const DIM_COLOR = 0x000000;
const DIM_ALPHA = 0.42;
/** The buildable-side lift: additive white, faint - the original's slight contrast boost. */
const BRIGHT_ALPHA = 0.08;
/** Upgrade ground: a warm ochre, set apart from the dim so it reads as "kept for this house", not as
 *  rough terrain. A project choice; the original draws no such hint. */
const RESERVE_COLOR = 0xd9a03a;
const RESERVE_ALPHA = 0.4;
/** Half-resolution compositing - halves the fill cost. */
const COMPOSITE_RESOLUTION = 0.5;
/** World-px pad each diamond grows by, so adjacent same-side cells fuse without hairline seams. Must
 *  exceed 2 composite px (2 / COMPOSITE_RESOLUTION world px); below that the pad is sub-pixel and
 *  neighbouring AA edges leave a visible seam lattice. */
const CELL_OVERLAP = 5;
/** The `round` brush's ground ellipse per open node, wide enough to fuse with its row and diagonal
 *  neighbours (nodes stand `TILE_HALF_W` apart in a row, a quarter cell between rows), and its feather:
 *  concentric steps from the rim inward, each scale with the alpha it adds. Tuned by eye. */
const ROUND_RADIUS = { x: 38, y: 22 } as const;
const ROUND_FEATHER: readonly { readonly scale: number; readonly alpha: number }[] = [
  { scale: 1, alpha: 0.3 },
  { scale: 0.85, alpha: 0.5 },
  { scale: 0.7, alpha: 1 },
];
/** The `round` brush's open side, lifted a little more than a building's buildable ground: the strip is
 *  the only thing a dock pick shows. Tuned by eye. */
const ROUND_BRIGHT_ALPHA = 0.18;
/** Composite-texture allocation step (texture px). */
const TEXTURE_QUANT = 128;

/** The world-space box of a band's composite, padded for the border diamonds + the terrain lift. */
interface OverlayBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The world-space bounds of a band's composite: the node centres' extent, odd rows a quarter cell right
 * of even ones, grown on every side by a border diamond's half-extents (`TILE_HALF_W` × `TILE_HALF_H/2`)
 * plus the fusing pad, and by the map's max terrain lift upward. Pure, so it tests without GL.
 */
export function overlayBounds(
  frame: Pick<PlacementOverlayFrame, 'minCol' | 'maxCol' | 'minRow' | 'maxRow'>,
  maxLift: number,
): OverlayBounds {
  // The westmost centre stands on an even row unless the band is one odd row; the eastmost on an odd one
  // unless it is one even row.
  const singleRow = frame.minRow === frame.maxRow;
  const left = halfCellToScreenX(frame.minCol, singleRow ? frame.minRow : 0);
  const right = halfCellToScreenX(frame.maxCol, singleRow ? frame.maxRow : 1);
  const top = halfCellToScreenY(frame.minRow);
  const bottom = halfCellToScreenY(frame.maxRow);
  const padX = TILE_HALF_W + CELL_OVERLAP;
  const padY = TILE_HALF_H / 2 + CELL_OVERLAP;
  return {
    x: left - padX,
    y: top - padY - maxLift,
    width: right - left + 2 * padX,
    height: bottom - top + 2 * padY + maxLift,
  };
}

export class PlacementOverlayLayer {
  readonly container = new Container();
  private readonly renderer: Renderer;
  /** The blocked cells' fused diamonds, tinted dark and translucent. */
  private readonly dim = new Sprite();
  /** The buildable cells' fused diamonds, additive and faint. */
  private readonly bright = new Sprite();
  /** The upgrade ground's fused diamonds, tinted ochre. */
  private readonly reserve = new Sprite();
  private dimTexture: RenderTexture | null = null;
  private brightTexture: RenderTexture | null = null;
  private reserveTexture: RenderTexture | null = null;
  /** The retained composite sources, cleared + refilled per recomposite (never re-allocated). */
  private readonly blockedG = new Graphics();
  private readonly buildableG = new Graphics();
  private readonly reservedG = new Graphics();
  /** The `round` brush's cut: the open side's texture erased out of the dim. A child's blend mode is
   *  honoured in a render where a root's is not, so the sprite renders under a host container. */
  private readonly eraseHost = new Container();
  private readonly eraser = new Sprite();
  /** Signature of the frame last composited - an unchanged signature skips the rebuild. */
  private key = '';

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.dim.tint = DIM_COLOR;
    this.dim.alpha = DIM_ALPHA;
    this.dim.visible = false;
    this.bright.blendMode = 'add';
    this.bright.alpha = BRIGHT_ALPHA;
    this.bright.visible = false;
    this.reserve.tint = RESERVE_COLOR;
    this.reserve.alpha = RESERVE_ALPHA;
    this.reserve.visible = false;
    this.container.addChild(this.dim, this.reserve, this.bright);
    this.eraser.blendMode = 'erase';
    this.eraseHost.addChild(this.eraser);
  }

  /** Recomposite the wash for a build-mode frame; `null` clears it. Diamonds are lifted onto the terrain
   *  like every projected item. */
  set(frame: PlacementOverlayFrame | null, elevation: ElevationField): void {
    if (frame === null || frame.minCol > frame.maxCol || frame.minRow > frame.maxRow) {
      if (this.key !== '') {
        for (const spr of [this.dim, this.bright, this.reserve]) spr.visible = false;
        this.key = '';
      }
      return;
    }
    const key = signatureOf(frame);
    if (key === this.key) return;

    const bounds = overlayBounds(frame, elevation.maxLift);
    this.ensureTextures(
      Math.max(1, Math.ceil(bounds.width * COMPOSITE_RESOLUTION)),
      Math.max(1, Math.ceil(bounds.height * COMPOSITE_RESOLUTION)),
    );
    const dimTexture = this.dimTexture;
    const brightTexture = this.brightTexture;
    const reserveTexture = this.reserveTexture;
    // ensureTextures always sets them
    if (dimTexture === null || brightTexture === null || reserveTexture === null) return;

    if (frame.brush === 'round') {
      this.composeRound(frame, elevation, bounds, dimTexture, brightTexture, reserveTexture);
      this.show(bounds, dimTexture, brightTexture, reserveTexture, ROUND_BRIGHT_ALPHA);
      this.key = key;
      return;
    }
    const blocked = new Set<string>();
    for (const c of frame.blocked) blocked.add(`${c.col},${c.row}`);
    const reserved = new Set<string>();
    for (const c of frame.reserved) reserved.add(`${c.col},${c.row}`);
    const blockedG = this.blockedG.clear();
    const buildableG = this.buildableG.clear();
    const reservedG = this.reservedG.clear();
    // Nodes stand HALF_W apart in a row and HALF_H/2 between rows, odd rows offset by HALF_W/2, so a
    // diamond of those half-extents on every node covers the plane with room to spare.
    const hw = (TILE_HALF_W + CELL_OVERLAP) * COMPOSITE_RESOLUTION;
    const hh = (TILE_HALF_H / 2 + CELL_OVERLAP) * COMPOSITE_RESOLUTION;
    for (let row = frame.minRow; row <= frame.maxRow; row++) {
      for (let col = frame.minCol; col <= frame.maxCol; col++) {
        // Project into composite-texture space: the lifted node point, less the band origin, at half res.
        const p = projectNode(elevation, col, row);
        const cx = (p.x - bounds.x) * COMPOSITE_RESOLUTION;
        const cy = (p.y - bounds.y) * COMPOSITE_RESOLUTION;
        const node = `${col},${row}`;
        const g = blocked.has(node) ? blockedG : reserved.has(node) ? reservedG : buildableG;
        g.poly(nodeDiamondPoly(cx, cy, hw, hh));
      }
    }
    blockedG.fill(0xffffff);
    buildableG.fill(0xffffff);
    reservedG.fill(0xffffff);

    // The textures may be quantized larger than the band, so `clear: true` blanks the margin and the
    // slack past the band's edge stays transparent.
    this.renderer.render({ container: blockedG, target: dimTexture, clear: true });
    this.renderer.render({ container: buildableG, target: brightTexture, clear: true });
    this.renderer.render({ container: reservedG, target: reserveTexture, clear: true });

    this.show(bounds, dimTexture, brightTexture, reserveTexture, BRIGHT_ALPHA);
    // Marked only now: a failed alloc or lost context above retries next frame instead of skipping on a
    // stale signature.
    this.key = key;
  }

  /**
   * The `round` brush: the dim covers the whole band less a feathered ground ellipse around every open
   * node, erased out of it, and the lift is those ellipses themselves, so both sides meet on one soft,
   * rounded edge. The band's reserved nodes, which only line tools name, draw nothing here.
   */
  private composeRound(
    frame: PlacementOverlayFrame,
    elevation: ElevationField,
    bounds: OverlayBounds,
    dimTexture: RenderTexture,
    brightTexture: RenderTexture,
    reserveTexture: RenderTexture,
  ): void {
    const closed = new Set<string>();
    for (const c of frame.blocked) closed.add(`${c.col},${c.row}`);
    for (const c of frame.reserved) closed.add(`${c.col},${c.row}`);
    const fullG = this.blockedG.clear();
    const openG = this.buildableG.clear();
    fullG
      .rect(0, 0, bounds.width * COMPOSITE_RESOLUTION, bounds.height * COMPOSITE_RESOLUTION)
      .fill(0xffffff);
    const rx = ROUND_RADIUS.x * COMPOSITE_RESOLUTION;
    const ry = ROUND_RADIUS.y * COMPOSITE_RESOLUTION;
    for (let row = frame.minRow; row <= frame.maxRow; row++) {
      for (let col = frame.minCol; col <= frame.maxCol; col++) {
        if (closed.has(`${col},${row}`)) continue;
        const p = projectNode(elevation, col, row);
        const cx = (p.x - bounds.x) * COMPOSITE_RESOLUTION;
        const cy = (p.y - bounds.y) * COMPOSITE_RESOLUTION;
        for (const step of ROUND_FEATHER) {
          openG
            .ellipse(cx, cy, rx * step.scale, ry * step.scale)
            .fill({ color: 0xffffff, alpha: step.alpha });
        }
      }
    }
    this.renderer.render({ container: fullG, target: dimTexture, clear: true });
    this.renderer.render({ container: openG, target: brightTexture, clear: true });
    // The same ellipses cut out of the dim; `erase` keeps the destination less the source's alpha.
    this.eraser.texture = brightTexture;
    this.renderer.render({ container: this.eraseHost, target: dimTexture, clear: false });
    this.renderer.render({ container: this.reservedG.clear(), target: reserveTexture, clear: true });
  }

  private show(
    bounds: OverlayBounds,
    dimTexture: RenderTexture,
    brightTexture: RenderTexture,
    reserveTexture: RenderTexture,
    brightAlpha: number,
  ): void {
    for (const spr of [this.dim, this.bright, this.reserve]) {
      spr.position.set(bounds.x, bounds.y);
      spr.scale.set(1 / COMPOSITE_RESOLUTION);
      spr.visible = true;
    }
    this.bright.alpha = brightAlpha;
    this.dim.texture = dimTexture;
    this.bright.texture = brightTexture;
    this.reserve.texture = reserveTexture;
  }

  /** Grow-only quantized (re)allocation of the composite textures. The visible col/row count flaps
   *  N↔N+1 as a smooth pan crosses tile phase, so exact-size allocation would recreate GPU textures
   *  every half tile of travel. */
  private ensureTextures(w: number, h: number): void {
    const quantW = Math.ceil(w / TEXTURE_QUANT) * TEXTURE_QUANT;
    const quantH = Math.ceil(h / TEXTURE_QUANT) * TEXTURE_QUANT;
    const current = this.dimTexture;
    if (current !== null && current.width >= quantW && current.height >= quantH) return;
    const newW = Math.max(quantW, current?.width ?? 0);
    const newH = Math.max(quantH, current?.height ?? 0);
    this.dimTexture?.destroy(true);
    this.brightTexture?.destroy(true);
    this.reserveTexture?.destroy(true);
    // Linear (default) sampling upscales the half-res composite into the soft, grid-free edge.
    this.dimTexture = RenderTexture.create({ width: newW, height: newH });
    this.brightTexture = RenderTexture.create({ width: newW, height: newH });
    this.reserveTexture = RenderTexture.create({ width: newW, height: newH });
  }

  destroy(): void {
    this.dimTexture?.destroy(true);
    this.brightTexture?.destroy(true);
    this.reserveTexture?.destroy(true);
    this.blockedG.destroy();
    this.buildableG.destroy();
    this.reservedG.destroy();
    this.eraseHost.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}

/** Order-sensitive signature of a frame - equal frames hash equal because the caller emits blocked and
 *  reserved cells in a fixed tile-scan order. */
function signatureOf(frame: PlacementOverlayFrame): string {
  const band = `${frame.minCol},${frame.maxCol},${frame.minRow},${frame.maxRow}`;
  const blocked = `${frame.blocked.length}:${hashCells(frame.blocked, frame.blocked.length)}`;
  const reserved = `${frame.reserved.length}:${hashCells(frame.reserved, frame.reserved.length)}`;
  return `${frame.brush ?? 'diamond'}:${band}:${blocked}:${reserved}`;
}
