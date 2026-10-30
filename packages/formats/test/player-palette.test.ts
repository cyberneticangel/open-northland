import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS, synthesizePlayerSource, toneRamp } from '../src/player-palette.js';
import { solidPalette as solid } from './fixtures/palette.js';

/**
 * Player-colour maths over synthetic palettes: the tone synthesiser (hue changes, greys stay neutral,
 * shade darkens or lifts, entries outside the team ranges untouched) and the slot table.
 */

/** Colour ranges 1, 2, 14 and 15 of a `playerNN.pcx`, the team colour. */
const TEAM_INDICES = (i: number): boolean => (i >= 16 && i < 48) || i >= 224;

describe('toneRamp', () => {
  it('rotates every entry and leaves its input alone', () => {
    const ramp = new Uint8Array([255, 0, 0, 128, 128, 128]);
    expect([...toneRamp(ramp, { hue: 240 })]).toEqual([0, 0, 255, 128, 128, 128]);
    expect([...ramp]).toEqual([255, 0, 0, 128, 128, 128]);
  });

  it('darkens toward black, lifts toward white and scales saturation', () => {
    const ramp = new Uint8Array([200, 0, 0]);
    expect([...toneRamp(ramp, { hue: 0, shade: -0.5 })]).toEqual([100, 0, 0]);
    expect([...toneRamp(ramp, { hue: 0, saturation: 0, shade: 0.5 })]).toEqual([227, 227, 227]);
  });
});

describe('synthesizePlayerSource', () => {
  it('tones the team ranges while keeping saturation/value; leaves the rest untouched', () => {
    const ref = solid(255, 0, 0); // pure red everywhere (hue 0, s=1, v=1)
    const out = synthesizePlayerSource(ref, { hue: 240 }); // team ranges → pure blue
    for (let i = 0; i < 256; i++) {
      const o = i * 3;
      if (TEAM_INDICES(i)) {
        expect([out[o], out[o + 1], out[o + 2]]).toEqual([0, 0, 255]);
      } else {
        expect([out[o], out[o + 1], out[o + 2]]).toEqual([255, 0, 0]); // outside the ramp unchanged
      }
    }
  });

  it('does not alias a Node Buffer reference (Buffer.slice shares memory)', () => {
    const ref = Buffer.from(solid(255, 0, 0));
    synthesizePlayerSource(ref, { hue: 240 });
    expect(Uint8Array.from(ref)).toEqual(solid(255, 0, 0));
  });
});

describe('PLAYER_COLORS', () => {
  it('defines 24 colours with ids 0..23 in order; 0..9 from pcx, the rest synthetic', () => {
    expect(PLAYER_COLORS.length).toBe(24);
    PLAYER_COLORS.forEach((c, i) => {
      expect(c.id).toBe(i);
      expect(c.source.kind).toBe(i < 10 ? 'pcx' : 'synthetic');
    });
    expect(PLAYER_COLORS[0]?.name).toBe('blue'); // the human player's default
  });
});
