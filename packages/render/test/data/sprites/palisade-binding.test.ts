import { describe, expect, it } from 'vitest';
import { resolvePalisadeDraw } from '../../../src/data/sprites/layered.js';
import type { PalisadeBinding } from '../../../src/data/sprites/layered-bindings.js';

const POST = 691;
const GATE = 696;
const OWNED = 1;
const UNBAKED = 2;

const frames = (layer: string) => [
  { layer, bob: 10 },
  { layer, bob: 0 },
];

describe('resolvePalisadeDraw - per-owner wall binding', () => {
  const binding: PalisadeBinding = {
    byGfxIndex: { [POST]: frames('ls_wall.goods_wood'), [GATE]: frames('ls_wall.goods_wood') },
    byPlayer: [undefined, { [POST]: frames('ls_wall.player_01') }, undefined],
    default: { layer: 'ls_wall.goods_wood', bob: 0 },
  };

  it("draws an owned wall from its owner's bake", () => {
    expect(resolvePalisadeDraw(binding, { gfxIndex: POST }, OWNED)).toEqual({
      bob: 0,
      layer: 'ls_wall.player_01',
    });
  });

  it('falls back to the record palette for an unowned wall, an unbaked colour or a missing record', () => {
    const plain = { bob: 0, layer: 'ls_wall.goods_wood' };
    expect(resolvePalisadeDraw(binding, { gfxIndex: POST })).toEqual(plain);
    expect(resolvePalisadeDraw(binding, { gfxIndex: POST }, UNBAKED)).toEqual(plain);
    expect(resolvePalisadeDraw(binding, { gfxIndex: GATE }, OWNED)).toEqual(plain);
  });
});
