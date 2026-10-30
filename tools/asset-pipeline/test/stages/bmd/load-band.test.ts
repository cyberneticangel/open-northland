import type { BobSequenceSet } from '@open-northland/data';
import { type Bmd, BOB_TYPE_8BIT, decodeBobFrame } from '@open-northland/formats/bmd/index';
import { describe, expect, it } from 'vitest';
import { packLineControl } from '../../../../../packages/formats/test/fixtures/bmd.js';
import { carriedLoadBandEdit } from '../../../src/stages/bmd/load-band.js';

const WOMAN_BMD = 'data/engine2d/bin/bobs/cr_hum_body_10_variant5.bmd';
const PLAIN_ID = 0;
const CARRY_ID = 1;

/**
 * Bob 0 is the plain walk, its dress (band 15) at x 0. Bob 1 is a carry frame anchored one column to the
 * left: dress-band pixels at x -1 and x 1, where the plain frame draws none, and the dress at x 0.
 */
function sheet(carryRun: readonly number[] = [0xf4, 0xf1, 0xf6]): Bmd {
  return {
    version: 0,
    firstBobId: 0,
    bobCount: 2,
    generatedNonEmptyLines: 0,
    generatedEmptyLines: 0,
    generatedPackedLines: 0,
    bobs: [
      { type: BOB_TYPE_8BIT, area: { x: 0, y: 0, width: 2, height: 1 }, misc: 0 },
      { type: BOB_TYPE_8BIT, area: { x: -1, y: 0, width: 3, height: 1 }, misc: 1 },
    ],
    packedLineData: Uint8Array.from([0x02, 0xf1, 0x52, 0x00, carryRun.length, ...carryRun, 0x00]),
    lineControl: Uint32Array.from([packLineControl(0, 0), packLineControl(0, 4)]),
  };
}

const sets = (carryLength = 1): BobSequenceSet[] => [
  {
    imagelib: 'cr_hum_body_10_variant5.bmd',
    sequences: [
      { name: 'human_woman_generic_walk', start: PLAIN_ID, length: 1 },
      { name: 'human_woman_generic_walk_food', start: CARRY_ID, length: carryLength },
    ],
  },
];

function edited(bmd: Bmd, bobId: number): number[] {
  const edit = carriedLoadBandEdit(WOMAN_BMD, bmd, sets());
  const frame = decodeBobFrame(bmd, bobId);
  edit?.(bobId, frame);
  return [...frame.pixels];
}

describe('carriedLoadBandEdit', () => {
  it("moves a carry frame's dress-band pixels off the plain walk's dress into the load band", () => {
    expect(edited(sheet(), CARRY_ID)).toEqual([0xc4, 0xf1, 0xc6]);
  });

  it('leaves the plain walk as it is', () => {
    expect(edited(sheet(), PLAIN_ID)).toEqual([0xf1, 0x52]);
  });

  it('edits no sheet of another body', () => {
    expect(carriedLoadBandEdit('data/engine2d/bin/bobs/cr_hum_body_00.bmd', sheet(), sets())).toBeUndefined();
  });

  it("throws when the body's sheet lacks a walk or a walk reaches past it", () => {
    expect(() => carriedLoadBandEdit(WOMAN_BMD, sheet(), [])).toThrow(/has no human_woman_generic_walk$/);
    const [set] = sets();
    const plainOnly = set === undefined ? [] : [{ ...set, sequences: set.sequences.slice(0, 1) }];
    expect(() => carriedLoadBandEdit(WOMAN_BMD, sheet(), plainOnly)).toThrow(/carry walk/);
    const past =
      set === undefined
        ? []
        : [
            {
              ...set,
              sequences: [
                ...set.sequences.slice(0, 1),
                { name: 'human_woman_generic_walk_food', start: 5, length: 1 },
              ],
            },
          ];
    expect(() => carriedLoadBandEdit(WOMAN_BMD, sheet(), past)).toThrow(/reaches past the sheet/);
  });

  it('throws when the sheet already draws in the load band or a carry walk does not pair', () => {
    expect(() => carriedLoadBandEdit(WOMAN_BMD, sheet([0xc4, 0xf1, 0xf6]), sets())).toThrow(
      /already draws in band 12/,
    );
    expect(() => carriedLoadBandEdit(WOMAN_BMD, sheet(), sets(2))).toThrow(/has 2 frames/);
  });
});
