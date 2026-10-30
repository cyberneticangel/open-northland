import { describe, expect, it } from 'vitest';
import { lightShare } from '../../../src/data/lighting/light-sites.js';

const HOUSES = Array.from({ length: 40 }, (_, i) => i + 1);

describe('lightShare', () => {
  it('keeps every light out by day', () => {
    expect(HOUSES.every((seed) => lightShare('building', seed, 0, 3) === 0)).toBe(true);
    expect(lightShare('fire', 1, 0, 3)).toBe(0);
  });

  it('lights the houses one by one through the dusk, all of them by full night', () => {
    const lit = (level: number) => HOUSES.filter((seed) => lightShare('building', seed, level, 3) > 0).length;
    expect(lit(0.2)).toBeGreaterThan(0);
    expect(lit(0.2)).toBeLessThan(HOUSES.length);
    expect(lit(0.5)).toBeGreaterThan(lit(0.2));
    expect(lit(1)).toBe(HOUSES.length);
  });

  it('flickers a house within its look, the same at the same game second', () => {
    const shares = [0, 0.3, 0.7, 1.1].map((t) => lightShare('building', 7, 1, t));
    expect(Math.min(...shares)).toBeGreaterThanOrEqual(0.88);
    expect(Math.max(...shares)).toBeLessThanOrEqual(1);
    expect(new Set(shares).size).toBeGreaterThan(1);
    expect(lightShare('building', 7, 1, 0.3)).toBe(shares[1]);
  });
});
