import type { GraphNode } from "../../audio/definitions/graph";

/** Each kind of box's accent in a graph (INST-44), as a token: blocks plain, sources and the output marked. */
export const ACCENTS: Record<GraphNode["kind"], string> = {
  block: "var(--color-line)",
  param: "var(--color-agent)",
  signal: "var(--color-you)",
  output: "var(--color-hot)",
};
