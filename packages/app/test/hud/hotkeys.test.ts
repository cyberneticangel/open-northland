import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFieldKey, isOrderHotkey } from '../../src/hud/hotkeys.js';
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from '../../src/hud/keybindings.js';

/** An order key answers with Shift held, so arming it keeps a Shift-queue going. */

const press = (code: string, shiftKey: boolean): KeyboardEvent =>
  ({
    code,
    shiftKey,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    target: null,
  }) as KeyboardEvent;

beforeEach(() => {
  for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLElement']) {
    vi.stubGlobal(name, class {});
  }
});
afterEach(() => vi.unstubAllGlobals());

describe('isOrderHotkey', () => {
  it('arms the attack-move with or without Shift', () => {
    const key = DEFAULT_KEY_BINDINGS.attackMove ?? '';
    expect(isOrderHotkey(press(key, false), DEFAULT_KEY_BINDINGS, 'attackMove')).toBe(true);
    expect(isOrderHotkey(press(key, true), DEFAULT_KEY_BINDINGS, 'attackMove')).toBe(true);
  });

  it('leaves a chord another action is bound to exactly to that action', () => {
    const bindings: KeyBindings = {
      ...DEFAULT_KEY_BINDINGS,
      roadTool: `Shift+${DEFAULT_KEY_BINDINGS.attackMove}`,
    };
    expect(isOrderHotkey(press(DEFAULT_KEY_BINDINGS.attackMove ?? '', true), bindings, 'attackMove')).toBe(
      false,
    );
  });
});

describe('isFieldKey', () => {
  const input = (type: string, value: string): EventTarget =>
    Object.assign(new (globalThis.HTMLInputElement as unknown as new () => HTMLInputElement)(), {
      type,
      value,
    });
  const pressIn = (code: string, target: EventTarget): KeyboardEvent => ({ ...press(code, false), target });

  it('leaves the map the arrows an empty search field has no caret for', () => {
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
      expect(isFieldKey(pressIn(code, input('search', '')))).toBe(false);
    expect(isFieldKey(pressIn('KeyW', input('search', '')))).toBe(true);
  });

  it('keeps the caret arrows of a field with text, and every arrow of a number field', () => {
    expect(isFieldKey(pressIn('ArrowLeft', input('text', 'Olaf')))).toBe(true);
    expect(isFieldKey(pressIn('ArrowUp', input('text', 'Olaf')))).toBe(false);
    expect(isFieldKey(pressIn('ArrowUp', input('number', '')))).toBe(true);
  });

  it('leaves the map the arrows of a checkbox', () => {
    expect(isFieldKey(pressIn('ArrowDown', input('checkbox', 'on')))).toBe(false);
    expect(isFieldKey(pressIn('Space', input('checkbox', 'on')))).toBe(true);
  });
});
