// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createActionHint } from '../../../../src/view/unit-controls/action-hint/controller.js';
import type { HintLine } from '../../../../src/view/unit-controls/action-hint/label.js';
import { snapshotOf } from '../../../support/snapshot.js';

const LINE: HintLine = { text: 'Atakuj po drodze', muted: false };
const WORLD = snapshotOf([]);

/** jsdom has no PointerEvent; the controller reads only these fields of one. */
function pointerMove(canvas: HTMLCanvasElement, x: number, y: number): void {
  const event = new MouseEvent('pointermove', { clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  canvas.dispatchEvent(event);
}

function harness(enabled: boolean) {
  const canvas = document.createElement('canvas');
  const shown: (HintLine | null)[] = [];
  let reads = 0;
  const hint = createActionHint({
    canvas,
    label: { show: (_x, _y, line) => shown.push(line), dispose: () => {} },
    camera: () => ({ offsetX: 0, offsetY: 0 }),
    versions: [],
    blocked: () => false,
    lineAt: () => {
      reads++;
      return LINE;
    },
    enabled,
  });
  pointerMove(canvas, 5, 5);
  return { hint, shown, reads: () => reads };
}

describe('the cursor hints setting', () => {
  it('keeps the label hidden and unread while the setting is off', () => {
    const h = harness(false);
    h.hint.update(WORLD);
    expect(h.shown).toEqual([null]);
    expect(h.reads()).toBe(0);
  });

  it('applies a change live: off hides the shown label, on shows it again', () => {
    const h = harness(true);
    h.hint.update(WORLD);
    h.hint.setEnabled(false);
    h.hint.update(WORLD);
    h.hint.setEnabled(true);
    h.hint.update(WORLD);
    expect(h.shown).toEqual([LINE, null, null, LINE]);
  });
});
