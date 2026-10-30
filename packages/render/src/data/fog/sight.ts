/** The viewer's sight, as the memories of changes made in the fog ask it. */
export interface Sight {
  /** Whether the viewer currently watches the cell of half-cell node (hx, hy). */
  seesNode(hx: number, hy: number): boolean;
  /** The fog cell index of half-cell node (hx, hy), the key {@link newlyVisible} lists. */
  cellOfNode(hx: number, hy: number): number;
  /** Bumps whenever {@link seesNode} may answer differently. */
  readonly revision: number;
  /** The cells that turned visible at the latest {@link revision}; null when that is unknown and every
   *  cell may have. */
  readonly newlyVisible: readonly number[] | null;
}

/**
 * Changes waiting for the viewer's sight, keyed by `K` and filed by fog cell, so a sight change rechecks
 * the changes under the cells it opened rather than every change still waiting.
 */
export class UnseenChanges<K> {
  private readonly cellOf = new Map<K, number>();
  private readonly byCell = new Map<number, Set<K>>();
  private checkedAt: number | null = null;

  get size(): number {
    return this.cellOf.size;
  }

  keys(): IterableIterator<K> {
    return this.cellOf.keys();
  }

  add(key: K, cell: number): void {
    this.delete(key);
    this.cellOf.set(key, cell);
    let keys = this.byCell.get(cell);
    if (keys === undefined) {
      keys = new Set();
      this.byCell.set(cell, keys);
    }
    keys.add(key);
  }

  delete(key: K): void {
    const cell = this.cellOf.get(key);
    if (cell === undefined) return;
    this.cellOf.delete(key);
    const keys = this.byCell.get(cell);
    keys?.delete(key);
    if (keys?.size === 0) this.byCell.delete(cell);
  }

  /** The changes `sight` may have opened since the last call: none while it holds, those under its newly
   *  visible cells after one step, every change after a missed step or an unknown one. */
  opened(sight: Sight): K[] {
    const last = this.checkedAt;
    this.checkedAt = sight.revision;
    if (last === sight.revision || this.cellOf.size === 0) return [];
    const cells = last !== null && sight.revision === last + 1 ? sight.newlyVisible : null;
    if (cells === null) return [...this.cellOf.keys()];
    const opened: K[] = [];
    for (const cell of cells) for (const key of this.byCell.get(cell) ?? []) opened.push(key);
    return opened;
  }
}
