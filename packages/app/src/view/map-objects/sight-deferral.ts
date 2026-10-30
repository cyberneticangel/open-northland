import { type Sight, UnseenChanges } from '@open-northland/render';

/**
 * A change to the map's static quads that waits until the viewer sees it: a tree felled, a deposit
 * mined out or scenery cleared under a wall in the fog keeps its last-seen quad until the player looks
 * again, as the fog's remembered statics do. One change per placement; a later one replaces it.
 */
export class SightDeferral {
  private readonly changes = new Map<number, () => void>();
  private readonly waiting = new UnseenChanges<number>();
  private readonly nodes = new Map<number, { readonly hx: number; readonly hy: number }>();

  constructor(private readonly sight: Sight) {}

  /** Apply `apply` now when the viewer sees (hx, hy), else once a {@link flush} finds it seen. */
  defer(placement: number, hx: number, hy: number, apply: () => void): void {
    if (this.sight.seesNode(hx, hy)) {
      this.forget(placement);
      apply();
      return;
    }
    this.changes.set(placement, apply);
    this.nodes.set(placement, { hx, hy });
    this.waiting.add(placement, this.sight.cellOfNode(hx, hy));
  }

  /** Apply the waiting changes under the cells the viewer's sight opened since the last flush. */
  flush(): void {
    for (const placement of this.waiting.opened(this.sight)) {
      const node = this.nodes.get(placement);
      const apply = this.changes.get(placement);
      if (node === undefined || apply === undefined || !this.sight.seesNode(node.hx, node.hy)) continue;
      this.forget(placement);
      apply();
    }
  }

  /** The placements whose change still waits. */
  pending(): IterableIterator<number> {
    return this.changes.keys();
  }

  private forget(placement: number): void {
    this.changes.delete(placement);
    this.nodes.delete(placement);
    this.waiting.delete(placement);
  }
}
