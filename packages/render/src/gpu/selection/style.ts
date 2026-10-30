export const SELECTION_STYLES = ['outline', 'pulse', 'ring-white', 'ring-green'] as const;
export type SelectionStyle = (typeof SELECTION_STYLES)[number];
export const DEFAULT_SELECTION_STYLE: SelectionStyle = 'outline';

export function parseSelectionStyle(value: unknown): SelectionStyle {
  return SELECTION_STYLES.find((style) => style === value) ?? DEFAULT_SELECTION_STYLE;
}

/** Artistic choice: a slow, shallow lift towards white; never darkens or hides the selected object. */
export function selectionLight(timeSeconds: number): number {
  return 0.07 + 0.025 * Math.sin((timeSeconds * Math.PI * 2) / 1.8);
}

/** A one-time acknowledgement on an order's target: an order lifts it towards white, an attack towards
 *  red, an assignment to a building towards green. A presentation addition, not taken from the original. */
export type TargetFlashTone = 'order' | 'attack' | 'assign';

export interface TargetFlash {
  readonly tone: TargetFlashTone;
  /** 0 when the order was given, 1 when the flash has played out. */
  readonly progress: number;
}

/** How an armed pick draws an entity it judged: a `candidate` takes the order, a `refused` one turns it down
 *  and draws plain (the pointer refuses over it), a `doomed` one is what the next press tears down. A
 *  presentation addition, not taken from the original. */
export type TargetTone = 'candidate' | 'refused' | 'doomed';

/** How a drawn tone outlines its entity, and the lift it takes while it is the one aimed at. Artistic
 *  choice: a pale sky-blue contour, apart from the ivory selection and the amber work flag and clear of
 *  straw roofs and grass, and the attack red for what a press destroys. */
export const TARGET_MARK_STYLE: Readonly<
  Record<Exclude<TargetTone, 'refused'>, { readonly outline: number; readonly liftTone: TargetFlashTone }>
> = {
  candidate: { outline: 0x7ee0ff, liftTone: 'order' },
  doomed: { outline: 0xff4f3d, liftTone: 'attack' },
};
/** The aimed target's lift, a steady step above the selection pulse's peak. */
export const TARGET_MARK_LIFT = 0.24;

/** Artistic choice: every other candidate breathes slowly between a faint and a clear lift, so the eye
 *  finds the targets across a busy settlement without mistaking them for the aimed one. */
const TARGET_BREATH_MEAN = 0.1;
const TARGET_BREATH_SWING = 0.07;
const TARGET_BREATH_PERIOD_SECONDS = 1.4;

export function targetMarkBreath(timeSeconds: number): number {
  return (
    TARGET_BREATH_MEAN +
    TARGET_BREATH_SWING * Math.sin((timeSeconds * Math.PI * 2) / TARGET_BREATH_PERIOD_SECONDS)
  );
}

/** The colour each lift tone moves towards, by tone code: white (the selection pulse's too), then each
 *  flash tone's. The sprite shaders index this array, so a code is its position here. */
const LIFT_COLOURS = ['vec3(1.0)', 'vec3(1.0, 0.5, 0.42)', 'vec3(0.6, 1.0, 0.5)'] as const;
export const LIFT_TONE_CODE: Readonly<Record<TargetFlashTone, number>> = { order: 0, attack: 1, assign: 2 };
/** The GLSL declaration of {@link LIFT_COLOURS} as `LIFT_COLOURS`, for both sprite shaders. */
export const LIFT_COLOURS_GLSL = `const int LIFT_TONES = ${LIFT_COLOURS.length};
const vec3 LIFT_COLOURS[LIFT_TONES] = vec3[LIFT_TONES](${LIFT_COLOURS.join(', ')});`;

/** Artistic choice: one short, faint swell and fade, above the selection pulse so it reads as the
 *  order's reply without covering the sprite. */
const TARGET_FLASH_PEAK = 0.15;

export function targetFlashLight(progress: number): number {
  return TARGET_FLASH_PEAK * Math.sin(Math.PI * Math.min(1, Math.max(0, progress)));
}
