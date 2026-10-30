import type { TargetMark } from '@open-northland/render';

/** A judged candidate's mark: lit when it takes the order, refused otherwise. */
export function markOf(id: number, takes: boolean): TargetMark {
  return { id, tone: takes ? 'candidate' : 'refused' };
}
