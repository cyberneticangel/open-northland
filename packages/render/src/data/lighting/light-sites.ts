import { frac } from '../effects/random.js';
import { smoothstep } from '../math.js';

/** What casts a pool of light on the ground at night: a finished building or an open fire. */
export type LightKind = 'building' | 'fire';

/** One light this frame, at a lifted world point (px before the camera). */
export interface LightSite {
  readonly kind: LightKind;
  /** Seeds a light's flicker and when it comes on: an entity id, or the object's position. */
  readonly seed: number;
  readonly x: number;
  readonly y: number;
}

export interface LightLook {
  /** Pool radius, world px at zoom 1. */
  readonly radius: number;
  /** A merging pool lights to its colour at {@link strength} and overlaps take the brighter, so a
   *  street stays one warm light; otherwise the pool adds {@link strength} of its colour over the
   *  others, up to the light map's daylight clamp. */
  readonly merges: boolean;
  /** At the pool's centre at a full night. */
  readonly strength: number;
  readonly colour: number;
  /** Share of the strength the flicker can take away; 0 holds steady. */
  readonly flicker: number;
  /** The visible flame over the pool, drawn above the darkness: its radius and strength, 0 for none. */
  readonly flareRadius: number;
  readonly flareStrength: number;
  /** Whether each light comes on at its own point of the dusk rather than with the night. */
  readonly staggered: boolean;
}

/** Tuned by eye. A house spills a low warm light round its foot, as from its door and windows; a fire a
 *  bright flickering one with a visible flame. */
export const LIGHT_LOOKS: Readonly<Record<LightKind, LightLook>> = {
  building: {
    merges: true,
    radius: 120,
    strength: 0.6,
    colour: 0xffd9a0,
    flicker: 0.12,
    flareRadius: 0,
    flareStrength: 0,
    staggered: true,
  },
  fire: {
    merges: false,
    radius: 240,
    strength: 0.42,
    colour: 0xff9a48,
    flicker: 0.25,
    flareRadius: 60,
    flareStrength: 0.4,
    staggered: false,
  },
};

/**
 * How much of the night a light-bearer's own figure keeps lit, tuned by eye: a settler or vehicle shows
 * part of its daylight colours, a house its lower walls more, fading toward the roof. Shares of the lit
 * mask, scaled by the night and, for a house, by {@link lightOn}: its walls hold steady while its pool
 * flickers, so a flicker repacks no quads.
 */
export const BEARER_GLOW = 0.65;
export const HOUSE_GLOW = 0.9;
/** Approximation tuned by eye: a house's light comes on once the night passes a level drawn per house
 *  below this, and takes {@link LIGHT_UP_RAMP} of the night's level to reach full. */
const LIGHT_UP_SPREAD = 0.5;
const LIGHT_UP_RAMP = 0.3;

/** Flicker rates in cycles per game second, one drawn per light within `[min, min + spread]`, plus a
 *  faster wave at {@link JITTER_RATE} times that, mixed in at {@link JITTER_SHARE}. */
const FLICKER_HZ_MIN = 1.2;
const FLICKER_HZ_SPREAD = 1;
const JITTER_RATE = 2.7;
const JITTER_SHARE = 0.35;
const PHASE_DRAW = 0;
const RATE_DRAW = 1;
const LIGHT_UP_DRAW = 2;
const TAU = 2 * Math.PI;

/** A light's share of its strength at `gameSeconds`: 1 for a steady one, so a pause holds it and every
 *  seat sees the same. */
export function lightFlicker(look: LightLook, seed: number, gameSeconds: number): number {
  if (look.flicker === 0) return 1;
  const phase = frac(seed, PHASE_DRAW);
  const t = gameSeconds * (FLICKER_HZ_MIN + FLICKER_HZ_SPREAD * frac(seed, RATE_DRAW)) + phase;
  const wave =
    (1 - JITTER_SHARE) * Math.sin(TAU * t) + JITTER_SHARE * Math.sin(TAU * (t * JITTER_RATE + phase));
  return 1 - look.flicker * (0.5 + 0.5 * wave);
}

/** How far a light is on under a night `level` (0 day, 1 full night): staggered lights come on one by
 *  one through the dusk, the others with the night. */
export function lightOn(kind: LightKind, seed: number, level: number): number {
  if (level <= 0) return 0;
  const look = LIGHT_LOOKS[kind];
  if (!look.staggered) return level;
  const from = LIGHT_UP_SPREAD * frac(seed, LIGHT_UP_DRAW);
  return smoothstep(from, from + LIGHT_UP_RAMP, level);
}

/** A light's share of its strength under a night `level`: {@link lightOn}, flickering by its look. */
export function lightShare(kind: LightKind, seed: number, level: number, gameSeconds: number): number {
  const on = lightOn(kind, seed, level);
  return on === 0 ? 0 : on * lightFlicker(LIGHT_LOOKS[kind], seed, gameSeconds);
}

/** A frame's lights over grow-only records, so refilling it allocates per new light, not per frame. */
export class LightSiteList {
  private readonly list: LightSite[] = [];
  private readonly records: { kind: LightKind; seed: number; x: number; y: number }[] = [];

  /** Valid until the next {@link clear}. */
  get sites(): readonly LightSite[] {
    return this.list;
  }

  clear(): void {
    this.list.length = 0;
  }

  push(kind: LightKind, seed: number, x: number, y: number): void {
    let record = this.records[this.list.length];
    if (record === undefined) {
      record = { kind, seed, x, y };
      this.records.push(record);
    }
    record.kind = kind;
    record.seed = seed;
    record.x = x;
    record.y = y;
    this.list.push(record);
  }
}
