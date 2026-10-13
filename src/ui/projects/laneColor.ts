/**
 * Lane colours, by track position. Clips are coloured by author in the arrangement, which would make
 * every solo project one colour here; until clips carry their own colours (DAW-47) a thumbnail tells
 * lanes apart by position instead.
 */
const LANE_COLORS = [
  "var(--color-you)",
  "var(--color-hot)",
  "var(--color-muted)",
  "var(--color-agent)",
  "var(--color-warn)",
  "var(--color-good)",
];

/** The colour a track's lane gets, by its position in the project, so a row can match its lane. */
export const laneColor = (index: number) => LANE_COLORS[index % LANE_COLORS.length];
