import type { Camera, WorldBounds } from '@open-northland/render';

/** The pure pan and zoom reducers and their bounds; each takes a {@link Camera} and returns a new one. */

/**
 * Zoom bounds the scroll wheel clamps to. The lower bound caps the visible tile and bob count, and so
 * the frame cost, rather than fitting a whole map on screen: a mid-size decoded map must not fit whole.
 * Lower it only together with a zoom-out LOD.
 */
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 8;
/**
 * The zoom-out floor the admin tools can unlock: a 250x250 map (68 x 38 px cells) fits whole on a
 * 1920x1080 screen. It lifts the frame-cost cap above, so it stays a debug option.
 */
export const DEBUG_MIN_ZOOM = 0.1;
/** CSS px from a canvas edge within which the pointer edge-scrolls. */
export const EDGE_SCROLL_MARGIN = 24;
/**
 * Approximation: CSS px from the edge within which the pointer still edge-scrolls over HUD chrome, so
 * hovering a top-bar item stays put while a cursor pushed against the screen edge keeps scrolling.
 */
export const HUD_EDGE_SCROLL_REACH = 4;

/** The interactive camera's speed knobs, read each frame by the controller. */
export interface CameraTuning {
  /** Screen px/s the camera pans while an arrow key is held. */
  readonly arrowPanSpeed: number;
  /** Edge-scroll speed (screen px/s) at the deepest point of the margin; ramps linearly from 0. */
  readonly edgeScrollSpeed: number;
  /** Wheel-zoom glide speed in log-zoom units per second, so each factor of e takes `1/rate` seconds
   *  and a long glide never lurches then crawls like an exponential ease. */
  readonly zoomGlideRate: number;
}

/** Approximation: eye-tuned speeds. The zoom rate lands one wheel notch in roughly two frames. */
export const DEFAULT_CAMERA_TUNING: CameraTuning = {
  arrowPanSpeed: 900,
  edgeScrollSpeed: 1500,
  zoomGlideRate: 4,
};

/**
 * The edge-scroll pan velocity in screen px/s for a pointer at canvas CSS position `(x, y)`. Ramps
 * linearly from 0 at the margin's inner boundary to `speed` at the edge, and is zero deeper inside or
 * deeper than `reach`, which cuts the band short without changing its speed near the edge.
 * Scroll convention: a pointer at the left edge reveals the world leftward, giving a positive `vx`.
 */
export function edgePanVelocity(
  x: number,
  y: number,
  width: number,
  height: number,
  speed: number,
  reach: number = EDGE_SCROLL_MARGIN,
): { vx: number; vy: number } {
  const depth = (into: number): number =>
    into >= Math.min(reach, EDGE_SCROLL_MARGIN)
      ? 0
      : (EDGE_SCROLL_MARGIN - Math.max(0, into)) / EDGE_SCROLL_MARGIN;
  return {
    vx: (depth(x) - depth(width - x)) * speed,
    vy: (depth(y) - depth(height - y)) * speed,
  };
}

/**
 * Where a pointer that left the window through `(x, y)` keeps edge-scrolling: pinned to every edge it
 * was within the margin of, or to the nearest edge after a flick that left from deeper inside. Canvas
 * CSS px in and out, so {@link edgePanVelocity} reads it like a cursor pressed against that edge.
 */
export function edgeExitPoint(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const distances = [x, width - x, y, height - y];
  const nearest = Math.min(...distances);
  const pinned = (distance: number): boolean => distance < EDGE_SCROLL_MARGIN || distance === nearest;
  const [left, right, top, bottom] = distances.map(pinned);
  return {
    x: left ? 0 : right ? width : Math.min(width, Math.max(0, x)),
    y: top ? 0 : bottom ? height : Math.min(height, Math.max(0, y)),
  };
}

/**
 * One step of the wheel-zoom glide: move the scale toward `target` at a constant `ratePerS` in log-zoom
 * space, so doubling takes the same time from 1 to 2 as from 4 to 8. Anchored at the cursor, and lands
 * exactly on the target once within one step of it.
 */
export function stepZoomToward(
  cam: Camera,
  target: number,
  cursorX: number,
  cursorY: number,
  dtMs: number,
  ratePerS: number,
  minZoom: number = MIN_ZOOM,
): Camera {
  const scale = cam.scale ?? 1;
  if (scale === target) return cam;
  const gap = Math.log(target / scale);
  const step = (ratePerS * dtMs) / 1000;
  const next = Math.abs(gap) <= step ? target : scale * Math.exp(Math.sign(gap) * step);
  return zoomCameraAt(cam, next / scale, cursorX, cursorY, minZoom);
}

/** Device px per art px of the one integer zoom level below 1: each device px takes every other texel. */
const HALF_PIXEL_LEVEL = 0.5;

/**
 * The integer zoom levels within `[minZoom, MAX_ZOOM]`, ascending: the scales at which one art
 * pixel covers ½ or a whole number of device px. `resolution` is device px per screen px, so a 2× display
 * reaches 1.5 (three device px) and a 1.25× display has no level at scale 1. Never empty, since
 * consecutive levels differ by at most a factor of 2 and the bounds span more.
 */
export function integerZoomLevels(resolution: number, minZoom: number = MIN_ZOOM): number[] {
  const levels: number[] = [];
  const add = (devicePerArt: number): void => {
    const scale = devicePerArt / resolution;
    if (scale >= minZoom && scale <= MAX_ZOOM) levels.push(scale);
  };
  add(HALF_PIXEL_LEVEL);
  for (let device = 1; device / resolution <= MAX_ZOOM; device++) add(device);
  return levels;
}

/** The level nearest `scale` in log-zoom space, so 0.7 between ½ and 1 snaps to the closer ratio. */
export function nearestZoomLevel(levels: readonly number[], scale: number): number {
  let best = levels[0] ?? scale;
  for (const level of levels) {
    if (Math.abs(Math.log(level / scale)) < Math.abs(Math.log(best / scale))) best = level;
  }
  return best;
}

/** The level one step from `scale` toward `direction` (+1 in, -1 out), or the end level at a bound. */
export function stepZoomLevel(levels: readonly number[], scale: number, direction: 1 | -1): number {
  const current = nearestZoomLevel(levels, scale);
  const index = levels.indexOf(current) + direction;
  return levels[Math.min(levels.length - 1, Math.max(0, index))] ?? current;
}

/** Pan the camera by a screen-pixel delta, preserving `scale`. */
export function panCamera(cam: Camera, dx: number, dy: number): Camera {
  return { ...cam, offsetX: cam.offsetX + dx, offsetY: cam.offsetY + dy };
}

/**
 * Clamp the camera so the viewport centre stays inside `bounds` — the same projected `WorldBounds` the
 * minimap reads — whatever pan, zoom or jump produced it. Solved for the offset rather than the centre,
 * so a camera pinned at an edge is a fixed point instead of hunting the bound by float rounding. Returns
 * the same object when already inside.
 *
 * Approximation: the original's allowance for viewing past the map edge is unrecorded; the limit is the
 * bounds rectangle with no margin.
 */
export function clampCameraToBounds(
  cam: Camera,
  bounds: WorldBounds,
  viewWidth: number,
  viewHeight: number,
): Camera {
  const scale = cam.scale ?? 1;
  // centre = (view/2 - offset)/scale ∈ [minX, minX + width] solved for the offset.
  const loX = viewWidth / 2 - (bounds.minX + bounds.width) * scale;
  const hiX = viewWidth / 2 - bounds.minX * scale;
  const loY = viewHeight / 2 - (bounds.minY + bounds.height) * scale;
  const hiY = viewHeight / 2 - bounds.minY * scale;
  const offsetX = Math.min(Math.max(cam.offsetX, loX), hiX);
  const offsetY = Math.min(Math.max(cam.offsetY, loY), hiY);
  if (offsetX === cam.offsetX && offsetY === cam.offsetY) return cam;
  return { ...cam, offsetX, offsetY };
}

/**
 * Zoom by `factor`, keeping the world point under `(cursorX, cursorY)` pinned to that screen point. With
 * `screen = world*scale + offset` the world under the cursor is `(cursor - offset)/scale`, and the offset
 * is re-solved after rescaling. The new scale is clamped to `[minZoom, MAX_ZOOM]`.
 */
export function zoomCameraAt(
  cam: Camera,
  factor: number,
  cursorX: number,
  cursorY: number,
  minZoom: number = MIN_ZOOM,
): Camera {
  const scale = cam.scale ?? 1;
  const next = Math.min(MAX_ZOOM, Math.max(minZoom, scale * factor));
  if (next === scale) return cam;
  const worldX = (cursorX - cam.offsetX) / scale;
  const worldY = (cursorY - cam.offsetY) / scale;
  return { offsetX: cursorX - worldX * next, offsetY: cursorY - worldY * next, scale: next };
}
