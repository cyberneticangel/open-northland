import { type Camera, tileToScreen } from '@open-northland/render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cameraCenteredOnTile,
  cameraCenteredOnWorld,
  cameraForViewportResize,
  clampCameraToBounds,
  DEBUG_MIN_ZOOM,
  DEFAULT_CAMERA_TUNING,
  EDGE_SCROLL_MARGIN,
  edgeExitPoint,
  edgePanVelocity,
  integerZoomLevels,
  MAX_ZOOM,
  MIN_ZOOM,
  nearestZoomLevel,
  panCamera,
  screenScale,
  stepZoomLevel,
  stepZoomToward,
  zoomCameraAt,
} from '../../../src/view/camera/index.js';

/**
 * The headless half of the interactive camera: the pan/zoom *math* is pure, so it's unit-tested here
 * (including `screenScale`, the CSS-px → Pixi-screen-px mapping every drag/pick/hit-test rides on).
 * `createCameraController`'s edge-scroll arming is covered in `camera-controller.test.ts`; the rest of
 * its DOM wiring and the *feel* of the result stay human-gated (the `npm run dev` pass).
 */

/** A canvas stub with a `width×height` device-px backing store shown in a `cssW×cssH` CSS box. */
const fakeCanvas = (width: number, height: number, cssW: number, cssH: number): HTMLCanvasElement =>
  ({
    width,
    height,
    getBoundingClientRect: () => ({ width: cssW, height: cssH, left: 0, top: 0 }) as DOMRect,
  }) as unknown as HTMLCanvasElement;

describe('screenScale', () => {
  it('maps CSS px to Pixi SCREEN px through the renderer resolution (not raw backing-store px)', () => {
    // A DPR-2 window canvas: 2560×1600 device px at resolution 2 = a 1280×800 SCREEN, in a 1280×800 CSS
    // box → 1 screen px per CSS px. Dividing by resolution is the point - raw device px would give 2.
    expect(screenScale(fakeCanvas(2560, 1600, 1280, 800), 2)).toMatchObject({ sx: 1, sy: 1 });
    // The ?shot-style canvas: a fixed resolution-1 backing store CSS-stretched to a smaller box.
    const s = screenScale(fakeCanvas(1280, 800, 1000, 625), 1);
    expect(s.sx).toBeCloseTo(1.28);
    expect(s.sy).toBeCloseTo(1.28);
  });

  it('guards a zero-size CSS box (hidden canvas) with a neutral 1:1 scale', () => {
    expect(screenScale(fakeCanvas(2560, 1600, 0, 0), 2)).toMatchObject({ sx: 1, sy: 1 });
  });

  describe('on a watched canvas', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /** A canvas whose box reads count, under a resize observer and window the test drives. */
    function watchedCanvas() {
      const observers: (() => void)[] = [];
      const windowListeners = new Map<string, () => void>();
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            observers.push(callback);
          }
          observe(): void {}
        },
      );
      vi.stubGlobal('window', {
        addEventListener: (type: string, listener: () => void) => windowListeners.set(type, listener),
      });
      const box = { width: 1280, height: 800 };
      let reads = 0;
      const canvas = {
        width: 1280,
        height: 800,
        getBoundingClientRect: () => {
          reads++;
          return { ...box, left: 0, top: 0 } as DOMRect;
        },
      } as unknown as HTMLCanvasElement;
      return { canvas, box, reads: () => reads, observers, windowListeners };
    }

    it('measures the box once until the canvas resizes, the window resizes or scrolls', () => {
      const { canvas, reads, observers, windowListeners } = watchedCanvas();
      screenScale(canvas, 1);
      screenScale(canvas, 1);
      expect(reads()).toBe(1);
      for (const invalidate of [observers[0], windowListeners.get('resize'), windowListeners.get('scroll')]) {
        invalidate?.();
        screenScale(canvas, 1);
        screenScale(canvas, 1);
      }
      expect(reads()).toBe(4);
    });

    it('measures again when the backing store changes size before the observer reports', () => {
      const { canvas, box, reads } = watchedCanvas();
      expect(screenScale(canvas, 1)).toMatchObject({ sx: 1, sy: 1 });
      canvas.width = 640;
      box.width = 640;
      expect(screenScale(canvas, 1)).toMatchObject({ sx: 1, sy: 1 });
      expect(reads()).toBe(2);
    });
  });
});

describe('panCamera', () => {
  it('shifts the offset by the delta and preserves scale', () => {
    const cam: Camera = { offsetX: 100, offsetY: 50, scale: 2 };
    expect(panCamera(cam, 10, -5)).toEqual({ offsetX: 110, offsetY: 45, scale: 2 });
  });
});

describe('clampCameraToBounds', () => {
  const BOUNDS = { minX: 0, minY: 0, width: 1000, height: 800 };
  const VIEW_W = 800;
  const VIEW_H = 600;
  /** The world point the camera puts at the viewport centre. */
  const centreOf = (cam: Camera): { x: number; y: number } => {
    const scale = cam.scale ?? 1;
    return { x: (VIEW_W / 2 - cam.offsetX) / scale, y: (VIEW_H / 2 - cam.offsetY) / scale };
  };
  /** The stored offset is exact at the bound; deriving the centre back out rounds at a non-unit scale. */
  const CENTRE_EPSILON_PX = 1e-6;
  const insideBounds = (cam: Camera): boolean => {
    const { x, y } = centreOf(cam);
    return (
      x >= BOUNDS.minX - CENTRE_EPSILON_PX &&
      x <= BOUNDS.minX + BOUNDS.width + CENTRE_EPSILON_PX &&
      y >= BOUNDS.minY - CENTRE_EPSILON_PX &&
      y <= BOUNDS.minY + BOUNDS.height + CENTRE_EPSILON_PX
    );
  };

  it('returns the same camera when the centre is inside the bounds', () => {
    const cam: Camera = cameraCenteredOnWorld(500, 400, 1, VIEW_W, VIEW_H);
    expect(clampCameraToBounds(cam, BOUNDS, VIEW_W, VIEW_H)).toBe(cam);
  });

  it('pins the centre to the bounds edge, preserving scale', () => {
    const cam: Camera = cameraCenteredOnWorld(1200, 400, 1, VIEW_W, VIEW_H);
    const clamped = clampCameraToBounds(cam, BOUNDS, VIEW_W, VIEW_H);
    expect(clamped.scale).toBe(1);
    expect(centreOf(clamped)).toEqual({ x: BOUNDS.minX + BOUNDS.width, y: 400 });
  });

  it('is a fixed point for a camera pinned at the edge', () => {
    const cam: Camera = cameraCenteredOnWorld(1200, 400, 0.35, VIEW_W, VIEW_H);
    const clamped = clampCameraToBounds(cam, BOUNDS, VIEW_W, VIEW_H);
    expect(clampCameraToBounds(clamped, BOUNDS, VIEW_W, VIEW_H)).toBe(clamped);
  });

  it('clamps at a non-unit scale', () => {
    const cam: Camera = cameraCenteredOnWorld(1200, -400, 2, VIEW_W, VIEW_H);
    const clamped = clampCameraToBounds(cam, BOUNDS, VIEW_W, VIEW_H);
    expect(clamped.scale).toBe(2);
    expect(insideBounds(clamped)).toBe(true);
  });

  it('keeps the centre inside after a zoom about a corner leaves the bounds', () => {
    let cam: Camera = cameraCenteredOnWorld(500, 400, 1, VIEW_W, VIEW_H);
    // Two zoom-outs anchored at the screen's top-left corner push the centre past the map.
    cam = zoomCameraAt(cam, 0.5, 0, 0);
    cam = zoomCameraAt(cam, 0.5, 0, 0);
    const clamped = clampCameraToBounds(cam, BOUNDS, VIEW_W, VIEW_H);
    expect(insideBounds(clamped)).toBe(true);
  });

  it('keeps the centre inside when the view is larger than the map', () => {
    const cam: Camera = cameraCenteredOnWorld(500, 400, MIN_ZOOM, VIEW_W, VIEW_H);
    const tiny = { minX: 0, minY: 0, width: 200, height: 150 };
    const clamped = clampCameraToBounds(cam, tiny, VIEW_W, VIEW_H);
    const { x, y } = centreOf(clamped);
    expect(x).toBeGreaterThanOrEqual(tiny.minX);
    expect(x).toBeLessThanOrEqual(tiny.minX + tiny.width);
    expect(y).toBeGreaterThanOrEqual(tiny.minY);
    expect(y).toBeLessThanOrEqual(tiny.minY + tiny.height);
  });
});

describe('cameraCenteredOnTile', () => {
  it('projects the chosen tile to the viewport centre at the given zoom', () => {
    const [tileX, tileY, zoom, w, h] = [124, 23, 0.7, 1680, 1050];
    const cam = cameraCenteredOnTile(tileX, tileY, zoom, w, h);
    const s = tileToScreen(tileX, tileY);
    expect(cam.scale).toBe(zoom);
    // screen = world*scale + offset - the tile lands dead centre.
    expect(cam.offsetX + s.x * zoom).toBeCloseTo(w / 2);
    expect(cam.offsetY + s.y * zoom).toBeCloseTo(h / 2);
  });
});

describe('cameraForViewportResize', () => {
  it('keeps the centred world point centred after the viewport size changes', () => {
    const [worldX, worldY, zoom] = [125, -40, 1.5];
    const camera = cameraCenteredOnWorld(worldX, worldY, zoom, 800, 600);
    const resized = cameraForViewportResize(camera, 800, 600, 1280, 900);
    expect(resized.offsetX + worldX * zoom).toBeCloseTo(1280 / 2);
    expect(resized.offsetY + worldY * zoom).toBeCloseTo(900 / 2);
    expect(resized.scale).toBe(zoom);
  });
});

describe('zoomCameraAt', () => {
  /** screen = world*scale + offset. */
  const screenOf = (cam: Camera, worldX: number): number => worldX * (cam.scale ?? 1) + cam.offsetX;

  it('keeps the world point under the cursor pinned to that screen pixel', () => {
    const cam: Camera = { offsetX: 100, offsetY: 50, scale: 2 };
    const cursorX = 300;
    const cursorY = 200;
    // World point currently under the cursor, before zooming.
    const worldX = (cursorX - cam.offsetX) / (cam.scale ?? 1);
    const worldY = (cursorY - cam.offsetY) / (cam.scale ?? 1);
    const out = zoomCameraAt(cam, 2, cursorX, cursorY);
    expect(out.scale).toBe(4);
    // That same world point still projects to the cursor under the new camera.
    expect(out.offsetX + worldX * 4).toBeCloseTo(cursorX);
    expect(out.offsetY + worldY * 4).toBeCloseTo(cursorY);
  });

  it('treats a missing scale as 1', () => {
    const out = zoomCameraAt({ offsetX: 0, offsetY: 0 }, 2, 10, 10);
    expect(out.scale).toBe(2);
    // The point under the cursor (world 10 at scale 1) stays under the cursor at scale 2.
    expect(screenOf(out, 10)).toBeCloseTo(10);
  });

  it('clamps zoom-in at MAX_ZOOM and returns the camera untouched once clamped', () => {
    const cam: Camera = { offsetX: 0, offsetY: 0, scale: MAX_ZOOM };
    expect(zoomCameraAt(cam, 2, 100, 100)).toBe(cam); // identity when the clamp leaves scale unchanged
  });

  it('clamps zoom-out at MIN_ZOOM', () => {
    const cam: Camera = { offsetX: 0, offsetY: 0, scale: MIN_ZOOM };
    expect(zoomCameraAt(cam, 0.5, 100, 100)).toBe(cam);
    const partway = zoomCameraAt({ offsetX: 0, offsetY: 0, scale: MIN_ZOOM * 1.05 }, 0.5, 0, 0);
    expect(partway.scale).toBe(MIN_ZOOM);
  });

  it('zooms out past MIN_ZOOM down to a lowered floor', () => {
    const cam: Camera = { offsetX: 0, offsetY: 0, scale: MIN_ZOOM };
    expect(zoomCameraAt(cam, 0.5, 100, 100, DEBUG_MIN_ZOOM).scale).toBe(MIN_ZOOM * 0.5);
    expect(zoomCameraAt(cam, 0.01, 100, 100, DEBUG_MIN_ZOOM).scale).toBe(DEBUG_MIN_ZOOM);
  });
});

describe('edgePanVelocity', () => {
  const W = 800;
  const H = 600;
  const SPEED = DEFAULT_CAMERA_TUNING.edgeScrollSpeed;

  it('is zero anywhere deeper than the margin', () => {
    expect(edgePanVelocity(W / 2, H / 2, W, H, SPEED)).toEqual({ vx: 0, vy: 0 });
    expect(edgePanVelocity(EDGE_SCROLL_MARGIN, EDGE_SCROLL_MARGIN, W, H, SPEED)).toEqual({ vx: 0, vy: 0 });
  });

  it('pans toward the hovered edge (camera-scroll convention, like the arrows)', () => {
    // Left edge reveals the world leftward → positive vx (the world slides right), like ArrowLeft.
    expect(edgePanVelocity(0, H / 2, W, H, SPEED).vx).toBeGreaterThan(0);
    expect(edgePanVelocity(W, H / 2, W, H, SPEED).vx).toBeLessThan(0);
    expect(edgePanVelocity(W / 2, 0, W, H, SPEED).vy).toBeGreaterThan(0);
    expect(edgePanVelocity(W / 2, H, W, H, SPEED).vy).toBeLessThan(0);
  });

  it('ramps linearly with depth into the margin', () => {
    const shallow = edgePanVelocity(EDGE_SCROLL_MARGIN * 0.75, H / 2, W, H, SPEED).vx;
    const deep = edgePanVelocity(EDGE_SCROLL_MARGIN * 0.25, H / 2, W, H, SPEED).vx;
    expect(deep).toBeCloseTo(shallow * 3);
  });
});

describe('edgeExitPoint', () => {
  const W = 800;
  const H = 600;

  it('pins every edge the exit lay within the band of', () => {
    expect(edgeExitPoint(W - 3, 300, W, H)).toEqual({ x: W, y: 300 });
    expect(edgeExitPoint(5, -2, W, H)).toEqual({ x: 0, y: 0 });
  });

  it('pins a flick from deeper inside to the nearest edge only', () => {
    expect(edgeExitPoint(400, H - EDGE_SCROLL_MARGIN * 3, W, H)).toEqual({ x: 400, y: H });
  });
});

describe('stepZoomToward', () => {
  const RATE = DEFAULT_CAMERA_TUNING.zoomGlideRate;
  it('glides toward the target and keeps the anchor point pinned', () => {
    const cam: Camera = { offsetX: 100, offsetY: 50, scale: 1 };
    const worldX = (400 - cam.offsetX) / 1;
    const stepped = stepZoomToward(cam, 2, 400, 300, 30, RATE);
    const scale = stepped.scale ?? 1;
    expect(scale).toBeGreaterThan(1);
    expect(scale).toBeLessThan(2);
    expect(stepped.offsetX + worldX * scale).toBeCloseTo(400);
  });

  it('snaps onto the target when nearly there, and is identity at the target', () => {
    const nearly: Camera = { offsetX: 0, offsetY: 0, scale: 1.9999 };
    expect(stepZoomToward(nearly, 2, 0, 0, 16, RATE).scale).toBe(2);
    const at: Camera = { offsetX: 0, offsetY: 0, scale: 2 };
    expect(stepZoomToward(at, 2, 0, 0, 16, RATE)).toBe(at);
  });

  it('converges to the target over repeated frames', () => {
    let cam: Camera = { offsetX: 0, offsetY: 0, scale: 1 };
    for (let i = 0; i < 120; i++) cam = stepZoomToward(cam, 3, 200, 200, 16, RATE);
    expect(cam.scale).toBe(3);
  });

  it('travels at a constant log-zoom rate (linear glide, no exponential fast-start)', () => {
    // The same dt covers the same log-zoom distance whether the target is far (1→8) or near (4→8).
    const early = stepZoomToward({ offsetX: 0, offsetY: 0, scale: 1 }, 8, 0, 0, 100, RATE);
    const late = stepZoomToward({ offsetX: 0, offsetY: 0, scale: 4 }, 8, 0, 0, 100, RATE);
    expect(Math.log((late.scale ?? 1) / 4)).toBeCloseTo(Math.log(early.scale ?? 1));
  });
});

describe('integerZoomLevels', () => {
  it('maps one art pixel to half or a whole number of device px within the zoom bounds', () => {
    expect(integerZoomLevels(1)).toEqual([0.5, 1, 2, 3, 4, 5, 6, 7, 8]);
    // A 2x display reaches 1.5 (three device px), and its half level falls below MIN_ZOOM.
    expect(integerZoomLevels(2).slice(0, 3)).toEqual([0.5, 1, 1.5]);
    expect(integerZoomLevels(2).at(-1)).toBe(MAX_ZOOM);
    // A 1.25x display has no level at scale 1.
    const fractional = integerZoomLevels(1.25);
    expect(fractional).not.toContain(1);
    expect(fractional[1]).toBeCloseTo(0.8);
    expect(fractional[2]).toBeCloseTo(1.6);
  });

  it('snaps to the nearest level in log space and steps one level at a time, holding at the bounds', () => {
    const levels = integerZoomLevels(1);
    expect(nearestZoomLevel(levels, 0.75)).toBe(1);
    expect(nearestZoomLevel(levels, 0.68)).toBe(0.5);
    expect(stepZoomLevel(levels, 1.3, 1)).toBe(2);
    expect(stepZoomLevel(levels, 1, -1)).toBe(0.5);
    expect(stepZoomLevel(levels, 0.5, -1)).toBe(0.5);
    expect(stepZoomLevel(levels, MAX_ZOOM, 1)).toBe(MAX_ZOOM);
  });
});
