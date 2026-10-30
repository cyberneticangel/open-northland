import { describe, expect, it } from 'vitest';
import { gradeLuma, nightLevel, shownGrade } from '../../../src/data/lighting/grade.js';
import type { LightGrade } from '../../../src/data/lighting/types.js';

/** North Guard's sunset (palette 64) and night (palette 58). */
const SUNSET: LightGrade = [1, 0.8, 0.7];
const NIGHT: LightGrade = [0.56, 0.56, 0.56];

describe('shownGrade', () => {
  it('keeps a sunset hue with little of its darkening and no night lights', () => {
    const shown = shownGrade(SUNSET, [1, 1, 1]);
    expect(gradeLuma(shown)).toBeCloseTo(0.94, 2);
    expect(shown[0]).toBeGreaterThan(shown[1]);
    expect(shown[1]).toBeGreaterThan(shown[2]);
    expect(nightLevel([1, 0.9, 0.8])).toBe(0);
  });

  it('shows a night a little brighter than written, leaning blue, with the lights full', () => {
    const shown = shownGrade(NIGHT, [1, 1, 1]);
    expect(gradeLuma(shown)).toBeCloseTo(0.626, 2);
    expect(shown[2]).toBeGreaterThan(shown[0]);
    expect(nightLevel(NIGHT)).toBe(1);
  });

  it('passes a brightening tint through', () => {
    expect(shownGrade([1.3, 1.1, 0.9], [1, 1, 1])).toEqual([1.3, 1.1, 0.9]);
  });
});
