/**
 * What a folded device or section says in place of its controls (DAW-61.3): how many it holds. Until a
 * device can name the few controls worth showing folded (its front panel, DAW-61), a count says what
 * is there without picking some at random.
 */
export const paramCount = (count: number) => `${count} ${count === 1 ? "param" : "params"}`;
