import type { RoadChanges } from '../scene/road-shards.js';
import { type Sight, UnseenChanges } from './sight.js';

/** The road network as the viewer last saw it, for the ground and the minimap to draw alike. */
export interface SeenRoadNetwork {
  /** Bumps whenever {@link nodes} changes. */
  readonly revision: number;
  /** The half-cell node ids (`hy * nodeWidth + hx`) the viewer believes laid. */
  readonly nodes: ReadonlySet<number>;
}

/**
 * The viewer's memory of the road network: a road laid or torn up out of sight changes nothing drawn
 * until the viewer sees its node, as the fog's remembered statics do. The network a game starts with is
 * known at once, like the map's terrain. Render-side and per local viewer, so the sim's determinism is
 * untouched. Work follows the changed and still-unseen nodes, never the whole network.
 */
export class SeenRoads implements SeenRoadNetwork {
  private readonly live = new Set<number>();
  private readonly shown = new Set<number>();
  /** Nodes whose live state differs from the shown one while the viewer does not see them. */
  private readonly waiting = new UnseenChanges<number>();
  private started = false;
  private restored: readonly number[] | null = null;
  private revisionValue = 0;

  constructor(readonly nodeWidth: number) {}

  get revision(): number {
    return this.revisionValue;
  }

  get nodes(): ReadonlySet<number> {
    return this.shown;
  }

  /** Start from a saved memory instead of the network as it stands; call before the first update. */
  restore(nodes: readonly number[]): void {
    this.restored = nodes;
  }

  /** Take the live network's `changes` and the viewer's `sight`; answers what the drawn network gains and
   *  loses, or null when it holds. */
  update(changes: RoadChanges | null, sight: Sight): RoadChanges | null {
    const added: number[] = [];
    const removed: number[] = [];
    const sync = (node: number): void => {
      const laid = this.live.has(node);
      if (laid === this.shown.has(node)) {
        this.waiting.delete(node);
        return;
      }
      const hx = node % this.nodeWidth;
      const hy = (node - hx) / this.nodeWidth;
      if (!sight.seesNode(hx, hy)) {
        this.waiting.add(node, sight.cellOfNode(hx, hy));
        return;
      }
      this.waiting.delete(node);
      if (laid) {
        this.shown.add(node);
        added.push(node);
      } else {
        this.shown.delete(node);
        removed.push(node);
      }
    };
    if (!this.started) {
      this.started = true;
      for (const node of changes?.added ?? []) this.live.add(node);
      const restored = this.restored;
      this.restored = null;
      for (const node of restored ?? this.live) {
        this.shown.add(node);
        added.push(node);
      }
      if (restored !== null) {
        for (const node of this.live) sync(node);
        for (const node of this.shown) sync(node);
      }
    } else if (changes !== null) {
      for (const node of changes.removed) this.live.delete(node);
      for (const node of changes.added) this.live.add(node);
      for (const node of changes.removed) sync(node);
      for (const node of changes.added) sync(node);
    }
    for (const node of this.waiting.opened(sight)) sync(node);
    if (added.length === 0 && removed.length === 0) return null;
    this.revisionValue++;
    return { added, removed };
  }
}
