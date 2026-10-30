/**
 * Player (team) colours. The original gives a player's humans the `player_NN` (male) or `woman_NN`
 * (female) `randompalette.ini` recipe of its colour, which patch the `Player NN` ramps (colour ranges
 * of a `playerNN.pcx`) onto clothing bands. The original ships 10 player colours; the other 14 are
 * toned approximations of player 0's with no original equivalent.
 */

import { assertPaletteBytes, PALETTE_RGB_BYTES } from './image.js';

/** Length of a 16-colour `[GfxPalette16]` ramp; colour range `n` holds indices `16n..16n+15`. */
const RAMP_LENGTH = 16;
/**
 * The colour ranges that carry the team colour in a `playerNN.pcx`: the ten shipped files differ in
 * ranges 1, 2, 14 and 15 (range 4 and index 112 vary too, but stay gold and black in every file).
 */
const TEAM_COLOR_RANGES: readonly number[] = [1, 2, 14, 15];
/** RGB bytes per palette entry. */
const RGB_BYTES = 3;

/**
 * A synthetic colour's tone over a reference ramp: every entry takes `hue` (degrees), its saturation is
 * scaled by `saturation`, and `shade` darkens toward black (negative) or lifts toward white (positive).
 */
export interface PlayerTone {
  readonly hue: number;
  readonly saturation?: number;
  readonly shade?: number;
}

export interface PlayerColorDef {
  readonly id: number;
  readonly name: string;
  /**
   * `pcx` reads the band from a shipped `playerNN.pcx`; `synthetic` tones the reference ramps, an
   * approximation with no original equivalent.
   */
  readonly source:
    | { readonly kind: 'pcx'; readonly file: string }
    | ({ readonly kind: 'synthetic' } & PlayerTone);
}

/**
 * The 24 player colours, slot order = player id. Ids 0–9 follow the original's `TPlayerColorId` order
 * (`logicdefines.inc`) and read their `pcx` files from `Data/engine2d/bin/palettes/creatures/`.
 */
export const PLAYER_COLORS: readonly PlayerColorDef[] = [
  { id: 0, name: 'blue', source: { kind: 'pcx', file: 'player01.pcx' } },
  { id: 1, name: 'red', source: { kind: 'pcx', file: 'player02.pcx' } },
  { id: 2, name: 'yellow', source: { kind: 'pcx', file: 'player03.pcx' } },
  { id: 3, name: 'cyan', source: { kind: 'pcx', file: 'player04.pcx' } },
  { id: 4, name: 'green', source: { kind: 'pcx', file: 'player05.pcx' } },
  { id: 5, name: 'purple', source: { kind: 'pcx', file: 'player06.pcx' } },
  { id: 6, name: 'grey', source: { kind: 'pcx', file: 'player07.pcx' } },
  { id: 7, name: 'orange', source: { kind: 'pcx', file: 'player08.pcx' } },
  { id: 8, name: 'neon', source: { kind: 'pcx', file: 'player09.pcx' } },
  { id: 9, name: 'black', source: { kind: 'pcx', file: 'player10.pcx' } },
  // Hue-rotated to fill the gaps between the shipped hues.
  { id: 10, name: 'spring', source: { kind: 'synthetic', hue: 140 } },
  { id: 11, name: 'teal', source: { kind: 'synthetic', hue: 168 } },
  { id: 12, name: 'azure', source: { kind: 'synthetic', hue: 205 } },
  { id: 13, name: 'indigo', source: { kind: 'synthetic', hue: 250 } },
  { id: 14, name: 'magenta', source: { kind: 'synthetic', hue: 312 } },
  { id: 15, name: 'pink', source: { kind: 'synthetic', hue: 336 } },
  // Darker and lighter tones, apart from the hues above by brightness as well.
  { id: 16, name: 'maroon', source: { kind: 'synthetic', hue: 350, shade: -0.5 } },
  { id: 17, name: 'navy', source: { kind: 'synthetic', hue: 225, shade: -0.5 } },
  { id: 18, name: 'olive', source: { kind: 'synthetic', hue: 58, saturation: 0.85, shade: -0.45 } },
  { id: 19, name: 'brown', source: { kind: 'synthetic', hue: 25, saturation: 0.8, shade: -0.5 } },
  { id: 20, name: 'forest', source: { kind: 'synthetic', hue: 125, saturation: 0.9, shade: -0.5 } },
  { id: 21, name: 'plum', source: { kind: 'synthetic', hue: 295, saturation: 0.75, shade: -0.45 } },
  { id: 22, name: 'white', source: { kind: 'synthetic', hue: 0, saturation: 0, shade: 0.6 } },
  { id: 23, name: 'lavender', source: { kind: 'synthetic', hue: 265, saturation: 0.45, shade: 0.35 } },
];

/**
 * A detached 768-byte copy of a palette. Not `p.slice()`: a decoded `.pcx` palette is a Node `Buffer`,
 * whose `slice` returns a view sharing memory.
 */
function copyPalette(p: Uint8Array): Uint8Array {
  const out = new Uint8Array(PALETTE_RGB_BYTES);
  out.set(p.subarray(0, PALETTE_RGB_BYTES));
  return out;
}

/** RGB (0–255) → HSV with h in [0,360), s/v in [0,1]. */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

/** HSV (h in degrees, s/v in [0,1]) → RGB (0–255, rounded). */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Tones every entry of `ramp` (RGB triples) by {@link PlayerTone}, keeping each entry's place in the
 * shading so a synthesised colour shades like a shipped one; near-grey entries stay neutral. Returns a
 * detached copy.
 */
export function toneRamp(ramp: Uint8Array, tone: PlayerTone): Uint8Array {
  const saturation = tone.saturation ?? 1;
  const shade = tone.shade ?? 0;
  const out = new Uint8Array(ramp.length);
  for (let o = 0; o + RGB_BYTES <= ramp.length; o += RGB_BYTES) {
    const [, s, v] = rgbToHsv(ramp[o] ?? 0, ramp[o + 1] ?? 0, ramp[o + 2] ?? 0);
    const value = shade < 0 ? v * (1 + shade) : v + (1 - v) * shade;
    out.set(hsvToRgb(tone.hue, Math.min(1, s * saturation), value), o);
  }
  return out;
}

/** Builds a synthetic player source palette: `reference` with its team-colour ranges toned by {@link toneRamp}. */
export function synthesizePlayerSource(reference: Uint8Array, tone: PlayerTone): Uint8Array {
  assertPaletteBytes(reference, 'player-palette', 'reference palette');
  const out = copyPalette(reference);
  for (const range of TEAM_COLOR_RANGES) {
    const start = range * RAMP_LENGTH * RGB_BYTES;
    out.set(toneRamp(reference.subarray(start, start + RAMP_LENGTH * RGB_BYTES), tone), start);
  }
  return out;
}
