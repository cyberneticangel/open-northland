import type { UiCue } from '@open-northland/audio';
import { describe, expect, it } from 'vitest';
import type { PlacementStrip, PlacementStripView } from '../../../src/hud/dom/placement-strip.js';
import { type ClientPoint, createWallDemolishBrush } from '../../../src/hud/tool-panel/wall-demolish.js';
import { messages } from '../../../src/i18n/index.js';

/** Walls stand in columns 20 px wide: x 100-119 is wall 1, x 140-159 wall 2, x 180-199 wall 3. */
const WALL_COLUMNS: readonly { readonly from: number; readonly id: number }[] = [
  { from: 100, id: 1 },
  { from: 140, id: 2 },
  { from: 180, id: 3 },
];
const WALL_WIDTH = 20;

function wallAt({ x }: ClientPoint): number | null {
  return WALL_COLUMNS.find(({ from }) => x >= from && x < from + WALL_WIDTH)?.id ?? null;
}

function mount() {
  let shown: PlacementStripView | null = null;
  const strip: PlacementStrip = {
    show: (view) => {
      shown = view;
    },
    clear: () => {
      shown = null;
    },
    dispose: () => undefined,
  };
  const demolished: number[] = [];
  const cues: UiCue[] = [];
  const brush = createWallDemolishBrush({
    strip,
    wallsAt: (points) => points.map(wallAt),
    demolish: (wall) => demolished.push(wall),
    cue: (cue) => cues.push(cue),
  });
  return { brush, demolished, cues, shown: () => shown };
}

describe('wall demolish brush', () => {
  it('takes no press until held, then names itself in the strip', () => {
    const { brush, demolished, shown } = mount();
    expect(brush.handleClick(110, 0)).toBe(false);
    brush.enter();
    expect(brush.isActive()).toBe(true);
    expect(shown()).toEqual({
      label: messages().hud.construction.wallDemolish,
      hint: messages().hud.construction.wallDemolishHint,
    });
    expect(demolished).toEqual([]);
  });

  it('orders a wall down once per stroke, and again on a stroke while it still stands', () => {
    const { brush, demolished, cues } = mount();
    brush.enter();
    expect(brush.handleClick(110, 0)).toBe(true);
    brush.handleDrag?.(60, 0);
    brush.handleDrag?.(115, 0);
    brush.handleRelease?.();
    expect(demolished).toEqual([1]);
    brush.handleClick(112, 0);
    brush.handleRelease?.();
    expect(demolished).toEqual([1, 1]);
    expect(cues).toEqual(['confirm', 'confirm']);
    expect(brush.isActive()).toBe(true);
  });

  it('tears down every wall a fast drag passes between two pointer events', () => {
    const { brush, demolished, cues } = mount();
    brush.enter();
    brush.handleClick(50, 0);
    brush.handleDrag?.(250, 0);
    brush.handleRelease?.();
    expect(demolished).toEqual([1, 2, 3]);
    expect(cues).toEqual(['confirm']);
  });

  it('paints only while the press it took is down', () => {
    const { brush, demolished } = mount();
    brush.enter();
    brush.handleDrag?.(110, 0);
    brush.handleClick(50, 0);
    brush.handleRelease?.();
    brush.handleDrag?.(150, 0);
    expect(demolished).toEqual([]);
  });

  it('fails a stroke that met no wall', () => {
    const { brush, demolished, cues } = mount();
    brush.enter();
    brush.handleClick(10, 0);
    brush.handleDrag?.(90, 0);
    brush.handleRelease?.();
    expect(demolished).toEqual([]);
    expect(cues).toEqual(['fail']);
  });

  it('marks the wall under the pointer doomed until it is ordered down, and nothing once dropped', () => {
    const { brush, shown } = mount();
    expect(brush.highlight({ x: 110, y: 0 })).toBeNull();
    brush.enter();
    const first = brush.highlight({ x: 110, y: 0 });
    expect(first).toEqual([{ id: 1, tone: 'doomed' }]);
    expect(brush.highlight({ x: 115, y: 0 })).toBe(first);
    expect(brush.highlight({ x: 10, y: 0 })).toEqual([]);
    brush.handleClick(110, 0);
    expect(brush.highlight({ x: 110, y: 0 })).toEqual([]);
    brush.cancel();
    expect(brush.isActive()).toBe(false);
    expect(brush.highlight({ x: 150, y: 0 })).toBeNull();
    expect(shown()).toBeNull();
  });
});
