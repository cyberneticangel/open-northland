import { describe, expect, it } from 'vitest';
import { SeenRoads } from '../../../src/data/fog/seen-roads.js';
import type { Sight } from '../../../src/data/fog/sight.js';

const NODE_WIDTH = 16;
const node = (hx: number, hy: number): number => hy * NODE_WIDTH + hx;
const START = node(2, 2);
const NEAR = node(4, 2);
const FAR = node(12, 12);

/** A viewer whose watched columns the test widens, one sight step per call; every step reopens all. */
function viewer(): { sight: Sight; watch(columns: number): void } {
  let revision = 0;
  let columns = 8;
  return {
    sight: {
      seesNode: (hx) => hx < columns,
      cellOfNode: () => 0,
      get revision() {
        return revision;
      },
      newlyVisible: null,
    },
    watch: (next) => {
      columns = next;
      revision++;
    },
  };
}

describe('SeenRoads', () => {
  it('shows the starting network at once, wherever it lies', () => {
    const { sight } = viewer();
    const roads = new SeenRoads(NODE_WIDTH);
    expect(roads.update({ added: [START, FAR], removed: [] }, sight)).toEqual({
      added: [START, FAR],
      removed: [],
    });
    expect([...roads.nodes]).toEqual([START, FAR]);
  });

  it('holds a road laid or torn up out of sight until the viewer sees its node', () => {
    const { sight, watch } = viewer();
    const roads = new SeenRoads(NODE_WIDTH);
    roads.update({ added: [START], removed: [] }, sight);
    expect(roads.update({ added: [NEAR, FAR], removed: [] }, sight)).toEqual({ added: [NEAR], removed: [] });
    expect(roads.update(null, sight)).toBeNull();
    watch(NODE_WIDTH);
    expect(roads.update(null, sight)).toEqual({ added: [FAR], removed: [] });
    watch(8);
    expect(roads.update({ added: [], removed: [FAR] }, sight)).toBeNull();
    expect(roads.nodes.has(FAR)).toBe(true);
    // Laid again before anyone looked: nothing the viewer saw ever changed.
    roads.update({ added: [FAR], removed: [] }, sight);
    watch(NODE_WIDTH);
    expect(roads.update(null, sight)).toBeNull();
  });

  it('starts from a restored memory and holds its unseen differences from the live network', () => {
    const { sight, watch } = viewer();
    const roads = new SeenRoads(NODE_WIDTH);
    roads.restore([START, FAR]);
    // Since the save NEAR was laid in sight, FAR torn up out of it, and a road laid far away.
    const far2 = node(14, 12);
    expect(roads.update({ added: [START, NEAR, far2], removed: [] }, sight)).toEqual({
      added: [START, FAR, NEAR],
      removed: [],
    });
    watch(NODE_WIDTH);
    expect(roads.update(null, sight)).toEqual({ added: [far2], removed: [FAR] });
  });
});
