import { smoothstep } from '../math.js';
import type { LightGrade } from './types.js';

/**
 * How a map script's whole-map tint is shown: an Open Northland look, tuned by eye, not the original's
 * plain multiply. A tint keeps its hue but loses most of its darkening, so a sunset colours the map
 * instead of dimming it; a night keeps enough darkness for the lights to stand out and turns cool.
 */

/** Rec. 709 luma weights. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;
/** Share of the script's darkness (1 - luma) shown, from a sunset with no night lights to a full night:
 *  a sunset at 0.84 luma shows at about 0.94, the North Guard night at 0.56 at about 0.63. */
const SUNSET_DARKNESS_KEPT = 0.35;
const NIGHT_DARKNESS_KEPT = 0.85;
/** Night lights burn fully from this script luma down and are out from {@link LIGHTS_OUT_LUMA} up, so
 *  they come up through the dusk, before the night bottoms out. */
const LIGHTS_FULL_LUMA = 0.6;
const LIGHTS_OUT_LUMA = 0.85;
/** The cool hue a night leans to, at luma 1, and how far a full night leans. */
const NIGHT_HUE: LightGrade = [0.9, 1, 1.18];
const NIGHT_HUE_SHARE = 0.5;

export function gradeLuma(grade: LightGrade): number {
  return LUMA_R * grade[0] + LUMA_G * grade[1] + LUMA_B * grade[2];
}

/** How strongly the night lights burn under a script grade: 0 by day and at sunset, 1 at night. */
export function nightLevel(script: LightGrade): number {
  return smoothstep(LIGHTS_OUT_LUMA, LIGHTS_FULL_LUMA, gradeLuma(script));
}

/** The grade drawn for a script grade, written into `out`. A brightening tint passes unchanged. */
export function shownGrade(script: LightGrade, out: [number, number, number]): [number, number, number] {
  const luma = gradeLuma(script);
  if (luma <= 0 || luma >= 1) {
    [out[0], out[1], out[2]] = script;
    return out;
  }
  const level = nightLevel(script);
  const kept = SUNSET_DARKNESS_KEPT + (NIGHT_DARKNESS_KEPT - SUNSET_DARKNESS_KEPT) * level;
  const shownLuma = 1 - (1 - luma) * kept;
  const lean = NIGHT_HUE_SHARE * level;
  for (let c = 0; c < 3; c++) {
    out[c] = ((script[c] ?? luma) / luma) * (1 - lean) + (NIGHT_HUE[c] ?? 1) * lean;
  }
  const scale = shownLuma / gradeLuma(out);
  out[0] *= scale;
  out[1] *= scale;
  out[2] *= scale;
  return out;
}
