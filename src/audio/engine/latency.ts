/**
 * Latency compensation (INST-36.7): a device can play late (a look-ahead limiter, a spectral block
 * declares how many samples), so everything summed beside it is delayed to match, and a project's
 * tracks stay in time with each other however their chains differ.
 *
 * Compensation is per bus: the children of a group (or of master) are delayed so they all arrive as
 * late as the latest of them. A group then plays that late, plus its own effects', to its parent.
 * Pure: the mixer (mixer.ts) reads each track's and group's latency and applies the delays this
 * gives with a DelayNode on the way to the parent.
 */

/** A track or group in the mix: where it goes, and how late its own chain makes it. */
export interface MixNode {
  id: string;
  /** Its group, or null for master. */
  parentId: string | null;
  /** Samples late from its own instrument and effects (a group: its effects). */
  latency: number;
}

/** The delay each node gets on its way to its parent, and how late master's input is in all. */
export interface Compensation {
  delays: Map<string, number>;
  total: number;
}

export const compensate = (tracks: MixNode[], groups: MixNode[]): Compensation => {
  const children = new Map<string | null, MixNode[]>();
  [...tracks, ...groups].forEach((node) => children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]));
  const groupIds = new Set(groups.map((group) => group.id));
  const delays = new Map<string, number>();
  /** How late a bus's children all arrive, once compensated, setting each one's delay. */
  const busLatency = (bus: string | null, visiting: Set<string>): number => {
    const arrivals = (children.get(bus) ?? []).map((node) => {
      // A group in a loop of parents (never made by the app) counts as having no children.
      const inner =
        groupIds.has(node.id) && !visiting.has(node.id) ? busLatency(node.id, new Set([...visiting, node.id])) : 0;
      return { id: node.id, arrival: inner + node.latency };
    });
    const latest = Math.max(0, ...arrivals.map(({ arrival }) => arrival));
    arrivals.forEach(({ id, arrival }) => delays.set(id, latest - arrival));
    return latest;
  };
  const total = busLatency(null, new Set());
  return { delays, total };
};
