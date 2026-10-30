import { describe, expect, it } from 'vitest';
import { type Sight, UnseenChanges } from '../../../src/data/fog/sight.js';

/** A sight that steps by hand, naming the cells each step opened. */
function steppedSight(): Sight & { step(opened: readonly number[] | null): void } {
  let revision = 0;
  let opened: readonly number[] | null = null;
  return {
    seesNode: () => false,
    cellOfNode: () => 0,
    get revision() {
      return revision;
    },
    get newlyVisible() {
      return opened;
    },
    step: (cells) => {
      opened = cells;
      revision++;
    },
  };
}

describe('UnseenChanges', () => {
  it('names only the changes under the cells a sight step opened, every change after a missed step', () => {
    const sight = steppedSight();
    const waiting = new UnseenChanges<string>();
    waiting.add('tree', 4);
    waiting.add('road', 9);
    expect(waiting.opened(sight)).toEqual(['tree', 'road']); // the first look knows no earlier sight
    expect(waiting.opened(sight)).toEqual([]); // a sight that holds opens nothing
    sight.step([9, 12]);
    expect(waiting.opened(sight)).toEqual(['road']);
    sight.step([4]);
    sight.step([]);
    expect(waiting.opened(sight)).toEqual(['tree', 'road']);
    waiting.delete('road');
    waiting.add('tree', 7);
    sight.step([4, 7]);
    expect(waiting.opened(sight)).toEqual(['tree']);
    expect(waiting.size).toBe(1);
  });
});
