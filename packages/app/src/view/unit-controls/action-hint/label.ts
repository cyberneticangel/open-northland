import { setClass, setHidden, write } from '../../../hud/dom/parts/dom.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { PlanHint } from './plan-hint.js';

/** What the label reads: a refusal is muted. */
export interface HintLine {
  readonly text: string;
  readonly muted: boolean;
}

/** The label's words: the named thing, the order's verb, or both joined. */
export function hintLine(
  name: string | null,
  hint: PlanHint | null,
  jobName: (jobType: number) => string,
): HintLine | null {
  const words = messages().hud.actionHint;
  let verb: string | null = null;
  if (hint?.tone === 'refusal') verb = words[hint.refusal];
  else if (hint?.tone === 'action')
    verb =
      hint.action === 'work' && hint.job !== null
        ? formatMessage(words.workAs, { job: jobName(hint.job) })
        : words[hint.action];
  if (verb === null) return name === null ? null : { text: name, muted: false };
  return { text: name === null ? verb : `${name} · ${verb}`, muted: hint?.tone === 'refusal' };
}

/** Design px from the cursor's tip down to the label's top, below the pointer's arrow. */
export const HINT_BELOW_CURSOR_PX = 20;
/** Design px the label starts left of the tip, so it reads as hanging under the pointer. */
const HINT_LEFT_OF_CURSOR_PX = 4;
/** Design px kept between the label and the screen edges. */
const HINT_EDGE_MARGIN_PX = 4;

export interface HintLabel {
  /** Shows `line` under the client point; null hides it. */
  show(clientX: number, clientY: number, line: HintLine | null): void;
  dispose(): void;
}

/** The label rides the DOM HUD plane in design px and takes no pointer events. */
export function createHintLabel(plane: HTMLElement, scale: () => number): HintLabel {
  const element = document.createElement('div');
  element.className = 'on-action-hint';
  element.hidden = true;
  plane.append(element);
  // Measured when the words change, not per frame the label follows the cursor. The plane's client box
  // is the design-px screen.
  let width = 0;
  let screenWidth = 0;
  let placedLeft = Number.NaN;
  let placedTop = Number.NaN;
  return {
    show(clientX, clientY, line): void {
      if (line === null) {
        setHidden(element, true);
        return;
      }
      const revealed = setHidden(element, false);
      const rewritten = write(element, line.text);
      setClass(element, 'on-action-hint--refusal', line.muted);
      if (revealed || rewritten) {
        width = element.offsetWidth;
        screenWidth = plane.clientWidth;
      }
      const s = scale();
      const room = screenWidth - width - HINT_EDGE_MARGIN_PX;
      const left = Math.max(HINT_EDGE_MARGIN_PX, Math.min(clientX / s - HINT_LEFT_OF_CURSOR_PX, room));
      const top = clientY / s + HINT_BELOW_CURSOR_PX;
      if (left === placedLeft && top === placedTop) return;
      placedLeft = left;
      placedTop = top;
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    },
    dispose: () => element.remove(),
  };
}
