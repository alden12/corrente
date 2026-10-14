/**
 * The effect abstraction. A track owns an ordered chain of effects; each sits
 * between the instrument output and the track gain. An effect is a node with an
 * input and an output, driven (like instruments) by its own ParamStore, so the
 * UI, MCP, and persistence treat it uniformly.
 */
export interface Effect {
  /** Feed the upstream signal here. */
  readonly input: AudioNode;
  /** The processed signal; connect into the next effect or the track gain. */
  readonly output: AudioNode;
  /**
   * The stage of the signal flow it was made for, if it cares (an effect on the new engine, INST-36.7):
   * moved to a place with another stage, it's made again rather than moved.
   */
  readonly stage?: number;
  /** How many samples late its output is, if any (INST-36.7): the mixer delays the other tracks to match. */
  readonly latency?: number;
  /** Resolves once it's ready to sound (an engine effect's plan and samples are in), for offline renders. */
  ready?(): Promise<void>;
  dispose(): void;
}
