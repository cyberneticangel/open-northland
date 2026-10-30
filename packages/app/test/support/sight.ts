import type { Sight } from '@open-northland/render';

/** A viewer's sight a test moves by hand: `look()` after changing what `seesNode` answers. No step names
 *  its opened cells, so each look rechecks every waiting change. */
export function testSight(seesNode: (hx: number, hy: number) => boolean = () => true): Sight & {
  look(): void;
} {
  let revision = 0;
  return {
    seesNode,
    cellOfNode: () => 0,
    get revision() {
      return revision;
    },
    newlyVisible: null,
    look: () => {
      revision++;
    },
  };
}
