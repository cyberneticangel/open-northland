import { describe, expect, it } from 'vitest';
import {
  decodeFogMemory,
  encodeFogMemory,
  type FogMemory,
} from '../../../../src/view/runtime/save-load/fog-memory.js';

const MEMORY: FogMemory = {
  mapId: 'magiczny_las',
  seat: 0,
  statics: {
    player: 0,
    reconSeeded: true,
    ghosts: [
      { ref: 4, kind: 'building', tileX: 5, tileY: 4, typeId: 7, tribe: 1, builtPct: 40, owner: 2 },
      {
        ref: 9,
        kind: 'palisade',
        tileX: 8.5,
        tileY: 6,
        shiftX: -17,
        palisadeSite: 'claimed',
        palisadePosts: [{ dx: 3, dy: -2, gfxIndex: 11, variantStep: 1, builtPct: 80 }],
      },
    ],
  },
  roads: [33, 34],
  layer: {
    removed: [1, 2],
    held: [
      [40, 3, 12],
      [41, 5, 'ripe'],
      [42, 6, null],
    ],
  },
};

describe('fog memory in a save', () => {
  it('reads back what it wrote', () => {
    expect(decodeFogMemory(encodeFogMemory(MEMORY))).toEqual(MEMORY);
    const blank = { mapId: null, seat: null, statics: null, roads: [], layer: null };
    expect(decodeFogMemory(encodeFogMemory(blank))).toEqual(blank);
  });

  it('drops a memory of another layout or a malformed one instead of failing the load', () => {
    const raw = JSON.parse(encodeFogMemory(MEMORY));
    expect(decodeFogMemory(null)).toBeNull();
    expect(decodeFogMemory('not json')).toBeNull();
    expect(decodeFogMemory(JSON.stringify({ ...raw, version: 0 }))).toBeNull();
    expect(decodeFogMemory(JSON.stringify({ ...raw, roads: [-1] }))).toBeNull();
    const ghost = (extra: object) =>
      JSON.stringify({
        ...raw,
        statics: { ...raw.statics, ghosts: [{ ...raw.statics.ghosts[0], ...extra }] },
      });
    expect(decodeFogMemory(ghost({ kind: 'settler' }))).toBeNull();
    expect(decodeFogMemory(ghost({ typeId: 'house' }))).toBeNull();
    expect(decodeFogMemory(ghost({ unknownField: 1 }))).toBeNull();
    expect(decodeFogMemory(JSON.stringify({ ...raw, layer: { ...raw.layer, held: [[40, 3]] } }))).toBeNull();
  });
});
