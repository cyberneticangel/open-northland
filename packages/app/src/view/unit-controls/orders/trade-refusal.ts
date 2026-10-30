import {
  type DiplomacyState,
  entityById,
  type HalfCellNode,
  nodeOfPosition,
  type WorldSnapshot,
} from '@open-northland/sim';
import { ownerPlayerOf, positionOf } from '../../../game/snapshot/index.js';

export interface TradeStances {
  readonly yours: DiplomacyState;
  readonly theirs: DiplomacyState;
}

/** The tribe whose house a route refused over the stances, and where that house stands. */
export interface TradeRefusal {
  readonly owner: number;
  readonly at: HalfCellNode | null;
}

/**
 * Whether the stances alone are why a trader's route refused `house`: another tribe's house that
 * `offersTrade` (standing, with agreements) while either side is short of `friend`. Null for any other
 * refusal, such as a house that would trade with nobody, which stays silent.
 */
export function tradeRefusal(
  snapshot: WorldSnapshot,
  house: number,
  viewer: number | null,
  offersTrade: boolean,
  stancesToward: (owner: number) => TradeStances,
): TradeRefusal | null {
  const entity = entityById(snapshot, house);
  const owner = entity === undefined ? undefined : ownerPlayerOf(entity);
  if (!offersTrade || entity === undefined || owner === undefined || viewer === null || owner === viewer) {
    return null;
  }
  const { yours, theirs } = stancesToward(owner);
  if (yours === 'friend' && theirs === 'friend') return null;
  const pos = positionOf(entity);
  return { owner, at: pos === undefined ? null : nodeOfPosition(pos.x, pos.y) };
}
