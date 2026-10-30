/**
 * Where a woman's carried load is drawn apart from her dress. Project choice, not the original's: her
 * body draws the load in the band her player recipe paints her dress with, so the original shows food,
 * crockery and the rest in the team colour. The pipeline moves each carry walk's load pixels of
 * {@link fromBand} into {@link band}, which her body draws nothing else in, and the renderer paints that
 * band with the good's colours.
 */
export const CARRIED_LOAD_BAND = {
  /** The body library, every variant included, whose sheets carry the moved load. */
  body: 'cr_hum_body_10',
  /** The walk without a load; each `<plainWalk>_<good>` carry walk draws the same body frame by frame. */
  plainWalk: 'human_woman_generic_walk',
  /** The dress band the load shares, which `woman_NN` paints in the team colour. */
  fromBand: 15,
  band: 12,
} as const;
