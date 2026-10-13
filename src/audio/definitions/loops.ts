/**
 * Ordering one section of a plan (INST-36.4): which nodes run one after another, and which form
 * feedback loops and how each loop runs. Pure graph work on node indices, so it's tested on its own.
 *
 * - **Loops are found, not forbidden**: the strongly connected components of the graph are its loops
 *   (Tarjan's algorithm), and everything outside them runs a whole block at a time, in dependency
 *   order.
 * - **A loop through a delay runs in chunks** when cutting its delays leaves no cycle and each delay's
 *   length comes from outside the loop: the delays read first, the rest run in dependency order over
 *   the chunk, the delays write last (engine/src/router/render.rs).
 * - **Any other loop runs a sample at a time**, ordered by dependency where it can be; where a cycle
 *   has to be broken, the node listed first in the definition reads the sample before. That is one
 *   sample of delay round the loop, where Web Audio needs 128.
 */

export type StepMode = "node" | "sample-loop" | "chunk-loop";

export interface Step {
  mode: StepMode;
  /** Node indices, in the order the step runs them. */
  nodes: number[];
}

/** What ordering needs to know about each node: which nodes it reads, and the delay's length input. */
export interface OrderNode {
  /** Indices of the nodes in this section it reads, with repeats allowed. */
  reads: number[];
  /** For a delay: the node its length comes from, if a node. Undefined for other blocks. */
  delayLength?: number | null;
}

/** Tarjan's algorithm: the strongly connected components, each a loop or a single node. */
const stronglyConnected = (nodes: OrderNode[]): number[][] => {
  const readers = nodes.map((_, index) =>
    nodes.flatMap((node, reader) => (node.reads.includes(index) ? [reader] : [])),
  );
  const order = new Array<number>(nodes.length).fill(-1);
  const low = new Array<number>(nodes.length).fill(0);
  const onStack = new Array<boolean>(nodes.length).fill(false);
  const stack: number[] = [];
  const components: number[][] = [];
  let next = 0;
  const visit = (node: number) => {
    order[node] = low[node] = next++;
    stack.push(node);
    onStack[node] = true;
    readers[node].forEach((reader) => {
      if (order[reader] === -1) {
        visit(reader);
        low[node] = Math.min(low[node], low[reader]);
      } else if (onStack[reader]) {
        low[node] = Math.min(low[node], order[reader]);
      }
    });
    if (low[node] === order[node]) {
      const component: number[] = [];
      let member: number;
      do {
        member = stack.pop()!;
        onStack[member] = false;
        component.push(member);
      } while (member !== node);
      components.push(component);
    }
  };
  nodes.forEach((_, node) => {
    if (order[node] === -1) visit(node);
  });
  // Tarjan finds sinks first; reversed, every component comes after the ones it reads.
  return components.reverse();
};

/**
 * Members in an order where each reads only members before it, as far as possible: repeatedly take
 * the first-listed member whose readings are all placed (ignoring `cut`, which are read from before
 * the loop runs), and when none is, the first-listed left, breaking the cycle there.
 */
const dependencyOrder = (nodes: OrderNode[], members: number[], cut: Set<number>) => {
  const inLoop = new Set(members);
  const placed: number[] = [];
  const isPlaced = new Set<number>();
  const ready = (member: number) =>
    nodes[member].reads.every((read) => !inLoop.has(read) || cut.has(read) || isPlaced.has(read) || read === member);
  const remaining = () =>
    [...members].sort((a, b) => a - b).filter((member) => !isPlaced.has(member) && !cut.has(member));
  for (let left = remaining(); left.length > 0; left = remaining()) {
    const next = left.find(ready);
    const chosen = next ?? left[0];
    placed.push(chosen);
    isPlaced.add(chosen);
  }
  return {
    order: placed,
    broken: placed.some((member, position) =>
      nodes[member].reads.some((read) => inLoop.has(read) && !cut.has(read) && placed.indexOf(read) >= position),
    ),
  };
};

/** How one loop runs: in chunks if every cycle passes through a delay whose length comes from outside. */
const orderLoop = (nodes: OrderNode[], members: number[]): Step => {
  const inLoop = new Set(members);
  const delays = members.filter((member) => nodes[member].delayLength !== undefined).sort((a, b) => a - b);
  const lengthsFromOutside = delays.every((delay) => {
    const length = nodes[delay].delayLength;
    return length === null || length === undefined || !inLoop.has(length);
  });
  if (delays.length > 0 && lengthsFromOutside) {
    const chunked = dependencyOrder(nodes, members, new Set(delays));
    if (!chunked.broken) return { mode: "chunk-loop", nodes: [...delays, ...chunked.order] };
  }
  return { mode: "sample-loop", nodes: dependencyOrder(nodes, members, new Set()).order };
};

/** The section's steps, in the order they run. */
export const orderSection = (nodes: OrderNode[]): Step[] =>
  stronglyConnected(nodes).map((component) => {
    const [only] = component;
    const readsItself = component.length === 1 && nodes[only].reads.includes(only);
    return component.length > 1 || readsItself ? orderLoop(nodes, component) : { mode: "node", nodes: component };
  });

/**
 * Whether a node reads `read` as a feedback edge (the sample before) in `step`: in a loop run a
 * sample at a time, any read of a member that runs at or after it.
 */
export const isFeedback = (step: Step, reader: number, read: number) =>
  step.mode === "sample-loop" && step.nodes.includes(read) && step.nodes.indexOf(read) >= step.nodes.indexOf(reader);
