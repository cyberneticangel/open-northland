import { describe, expect, it } from 'vitest';
import { ownerPaletteBmds } from '../../src/stages/player-colors.js';

const WALL = 82;
const TREE = 7;

describe('ownerPaletteBmds', () => {
  it('bakes the guidepost and every bob of a playeridallowed landscape, once each', () => {
    const bmds = ownerPaletteBmds({
      landscape: [
        { typeId: WALL, playerIdAllowed: true },
        { typeId: TREE, playerIdAllowed: false },
      ],
      landscapeGfx: [
        { logicType: WALL, bmd: 'data/engine2d/bin/bobs/ls_wall.bmd' },
        { logicType: WALL, bmd: 'data/engine2d/bin/bobs/ls_wall.bmd' },
        { logicType: TREE, bmd: 'data/engine2d/bin/bobs/ls_trees.bmd' },
      ],
    });
    expect(bmds).toEqual(['data/engine2d/bin/bobs/ls_guidepost.bmd', 'data/engine2d/bin/bobs/ls_wall.bmd']);
  });
});
