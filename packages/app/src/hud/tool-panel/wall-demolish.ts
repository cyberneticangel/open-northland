import type { UiCue } from '@open-northland/audio';
import type { TargetMark } from '@open-northland/render';
import { messages } from '../../i18n/index.js';
import type { PlacementStrip } from '../dom/placement-strip.js';
import type { HeldMode } from './input.js';

/** CSS px between the points a stroke tests, so a fast drag skips no wall between two pointer events;
 *  a wall segment's sprite is wider than this. Tuned by eye. */
export const STROKE_SAMPLE_PX = 6;

export interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

export interface WallDemolishDeps {
  readonly strip: PlacementStrip;
  /** The seat's own wall or gate drawn on top under each client point, or null there. Roads never
   *  answer. */
  readonly wallsAt: (points: readonly ClientPoint[]) => readonly (number | null)[];
  readonly demolish: (wall: number) => void;
  readonly cue: (cue: UiCue) => void;
}

/**
 * The wall brush, a named addition: while it is held, a press tears down the seat's wall or gate under
 * the cursor, and dragging with the button down tears down every one the cursor passes. Roads stay. The
 * brush stays held between strokes until Esc or the right button.
 */
export interface WallDemolishBrush extends HeldMode {
  enter(): void;
  /** The wall the next press would tear down, marked doomed; an empty list off every wall, null while
   *  the brush is not held. */
  highlight(pointer: ClientPoint | null): readonly TargetMark[] | null;
}

const NO_HIGHLIGHT: readonly TargetMark[] = [];

export function createWallDemolishBrush(deps: WallDemolishDeps): WallDemolishBrush {
  let active = false;
  /** Walls ordered down this stroke, which draw until the sim's tick removes them. A new stroke orders
   *  them again, so one a relay refused over its per-tick input budget falls to the next pass. */
  const ordered = new Set<number>();
  let stroke: { last: ClientPoint; hits: number } | null = null;
  let shown: readonly TargetMark[] = NO_HIGHLIGHT;

  const tearDown = (points: readonly ClientPoint[]): void => {
    if (stroke === null) return;
    for (const wall of deps.wallsAt(points)) {
      if (wall === null || ordered.has(wall)) continue;
      ordered.add(wall);
      deps.demolish(wall);
      if (stroke.hits === 0) deps.cue('confirm');
      stroke.hits += 1;
    }
  };

  const exit = (): void => {
    active = false;
    stroke = null;
    ordered.clear();
    deps.strip.clear();
  };

  return {
    isActive: () => active,
    enter: (): void => {
      active = true;
      stroke = null;
      const copy = messages().hud.construction;
      deps.strip.show({ label: copy.wallDemolish, hint: copy.wallDemolishHint });
    },
    cancel: (): void => {
      if (active) exit();
    },
    handleClick: (clientX, clientY): boolean => {
      if (!active) return false;
      const at = { x: clientX, y: clientY };
      stroke = { last: at, hits: 0 };
      ordered.clear();
      tearDown([at]);
      return true;
    },
    handleDrag: (clientX, clientY): void => {
      if (!active || stroke === null) return;
      const { last } = stroke;
      const steps = Math.ceil(Math.hypot(clientX - last.x, clientY - last.y) / STROKE_SAMPLE_PX);
      if (steps === 0) return;
      const points: ClientPoint[] = [];
      for (let i = 1; i <= steps; i++) {
        points.push({
          x: last.x + ((clientX - last.x) * i) / steps,
          y: last.y + ((clientY - last.y) * i) / steps,
        });
      }
      stroke.last = { x: clientX, y: clientY };
      tearDown(points);
    },
    handleRelease: (): void => {
      if (stroke === null) return;
      if (stroke.hits === 0) deps.cue('fail');
      stroke = null;
    },
    highlight: (pointer): readonly TargetMark[] | null => {
      if (!active) return null;
      const wall = pointer === null ? null : (deps.wallsAt([pointer])[0] ?? null);
      if (wall === null || ordered.has(wall)) shown = NO_HIGHLIGHT;
      else if (shown[0]?.id !== wall) shown = [{ id: wall, tone: 'doomed' }];
      return shown;
    },
  };
}
