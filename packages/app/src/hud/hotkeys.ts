import {
  isFunctionKeyCode,
  KEYBINDING_ACTIONS,
  type KeyBindings,
  type KeybindingAction,
  matchesKeyboardBinding,
  matchesKeyboardBindingUnderShift,
} from './keybindings.js';

/** Marks a control whose focused descendants keep their keys, as a dropdown's open list does. */
export const FIELD_KEYS_ATTRIBUTE = 'data-field-keys';

/**
 * True when a keydown may belong to the focused control rather than the game: a text field being typed
 * into, or a `<select>` or dropdown list, whose own type-ahead jumps to an option by its letters.
 */
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement &&
    (target.isContentEditable || target.closest(`[${FIELD_KEYS_ATTRIBUTE}]`) !== null));

/** `<input>` types with one line of text: no line to step to, and while empty no caret to move. */
const SINGLE_LINE_TEXT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
]);
/** `<input>` types no arrow key acts on. */
const ARROWLESS_INPUT_TYPES: ReadonlySet<string> = new Set([
  'checkbox',
  'button',
  'submit',
  'reset',
  'color',
  'file',
]);
const VERTICAL_ARROWS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown']);
const HORIZONTAL_ARROWS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight']);

/** True for an arrow press the focused `<input>` has no use for, so the map scrolls with a window's
 *  search field focused. */
function inputIgnoresArrow(input: HTMLInputElement, code: string): boolean {
  const vertical = VERTICAL_ARROWS.has(code);
  if (!vertical && !HORIZONTAL_ARROWS.has(code)) return false;
  if (ARROWLESS_INPUT_TYPES.has(input.type)) return true;
  return SINGLE_LINE_TEXT_TYPES.has(input.type) && (vertical || input.value === '');
}

/** True when the focused control keeps this keydown. No field types an F-key, so an F-row press stays
 *  the game's even from inside one, and an arrow the field cannot use stays the game's too. */
export const isFieldKey = (e: KeyboardEvent): boolean =>
  isTypingTarget(e.target) &&
  !isFunctionKeyCode(e.code) &&
  !(e.target instanceof HTMLInputElement && inputIgnoresArrow(e.target, e.code));

/** True for an exact, non-repeating action chord the focused control does not keep. */
export function isActionHotkey(e: KeyboardEvent, bindings: KeyBindings, action: KeybindingAction): boolean {
  return !e.repeat && !isFieldKey(e) && matchesKeyboardBinding(e, bindings[action]);
}

/** {@link isActionHotkey} for an order key, which also answers with Shift held, so arming it does not
 *  break a chain of Shift-queued orders; a chord another action is bound to exactly stays that action's. */
export function isOrderHotkey(e: KeyboardEvent, bindings: KeyBindings, action: KeybindingAction): boolean {
  if (e.repeat || isFieldKey(e)) return false;
  if (matchesKeyboardBinding(e, bindings[action])) return true;
  return (
    !KEYBINDING_ACTIONS.some((other) => matchesKeyboardBinding(e, bindings[other])) &&
    matchesKeyboardBindingUnderShift(e, bindings[action])
  );
}
