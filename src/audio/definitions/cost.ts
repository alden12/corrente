/**
 * What a definition costs to run, as a share of a phone's audio thread (INST-36.4's cost cap), from
 * the block costs measured into engine/costs.json (`yarn engine:costs`, on a laptop).
 *
 * - **A phone is taken as twice as slow** as the laptop the costs were measured on. Calibrated from
 *   Alden's phone running the prototype's plucked string at 0.2-0.25% of its thread a voice (DAW-60),
 *   where the same graph costs about 3.7 us a block here: 1.4 to 1.8 times, rounded up to be safe. A
 *   block of 128 samples at 48 kHz has 2.67 ms.
 * - **A device may take a quarter of the thread** with every voice sounding. About 60% of it is usable
 *   before glitches, so that leaves room for other tracks; past it, a definition is refused, and the
 *   problem says how heavy each voice is so the author can trim voices or blocks.
 *
 * Rough by nature: one machine's timings, scaled. It catches a definition that could never run on a
 * phone, not one that's slightly over.
 */
import costsJson from "../../../engine/costs.json";

interface Costs {
  /** Nanoseconds per block, by block name. */
  blocks: Record<string, number>;
  /** A sounding voice's own cost beyond its blocks. */
  voice: number;
  /** How many times dearer a block is in a loop run a sample at a time. */
  sampleLoop: number;
}

const COSTS: Costs = costsJson;
/** How much slower a phone is than the machine the costs were measured on. */
export const PHONE_SLOWDOWN = 2;
/** The share of a phone's audio thread one device may take, every voice sounding. */
export const DEVICE_CAP = 0.25;
/** A block's time at 48 kHz, in nanoseconds. */
const BLOCK_NS = (128 / 48000) * 1e9;
/** A block with no measured cost is taken to be as dear as the dearest that has one. */
const UNKNOWN = Math.max(...Object.values(COSTS.blocks));

/** One node's place, as cost sees it: its block, and whether it runs a sample at a time. */
export interface CostedNode {
  block: string;
  sampleLoop: boolean;
}

/** Shares of a phone's audio thread: once a block for the track, for each voice, and both together. */
export interface Cost {
  shared: number;
  perVoice: number;
  total: number;
}

const share = (nanoseconds: number) => (nanoseconds * PHONE_SLOWDOWN) / BLOCK_NS;
const nodesCost = (nodes: CostedNode[]) =>
  nodes.reduce(
    (total, node) => total + (COSTS.blocks[node.block] ?? UNKNOWN) * (node.sampleLoop ? COSTS.sampleLoop : 1),
    0,
  );

export const costOf = (shared: CostedNode[], voice: CostedNode[], voices: number): Cost => {
  const sharedShare = share(nodesCost(shared));
  const perVoice = voices > 0 ? share(nodesCost(voice) + COSTS.voice) : 0;
  return { shared: sharedShare, perVoice, total: sharedShare + perVoice * voices };
};

/** One of a block, run once a block, as a share of a phone's audio thread: for describing blocks. */
export const blockShare = (block: string): number => share(COSTS.blocks[block] ?? UNKNOWN);

/** A voice's own cost beyond its blocks, as a share of a phone's audio thread. */
export const voiceShare = (): number => share(COSTS.voice);

export const percent = (fraction: number) => `${(fraction * 100).toFixed(fraction < 0.01 ? 2 : 1)}%`;

/** Why a cost is over the cap, worded for whoever wrote the definition; undefined if it isn't. */
export const overCap = (cost: Cost, voices: number): string | undefined => {
  if (cost.total <= DEVICE_CAP) return undefined;
  const parts = [
    ...(voices > 0 ? [`${voices} voices at about ${percent(cost.perVoice)} each`] : []),
    ...(cost.shared > 0 ? [`${percent(cost.shared)} shared`] : []),
  ];
  return (
    `too heavy for a phone: ${parts.join(" and ")} is about ${percent(cost.total)} of its audio thread, over the ` +
    `${percent(DEVICE_CAP)} a device may take. Use fewer voices, or lighter blocks per voice.`
  );
};
