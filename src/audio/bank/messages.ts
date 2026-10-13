/**
 * What the main thread and an engine bank's worklet say to each other (INST-36.5). Times are
 * AudioContext seconds; a track is the bank's track slot, which is also the node's output index.
 */
import type { CompiledPlan } from "../definitions/compile";

export type ToBank =
  | { type: "load"; track: number; plan: CompiledPlan; values: Record<string, number> }
  | { type: "unload"; track: number }
  | { type: "noteOn"; track: number; note: number; velocity: number; time: number }
  | { type: "noteOff"; track: number; note: number; time: number }
  | { type: "allOff"; track: number; time: number }
  | { type: "param"; track: number; param: string; value: number; time: number }
  /** The bank is going: disconnecting a worklet node doesn't stop it, so it stops itself. */
  | { type: "stop" };

/** Whether a track's plan is with the engine now: an offline render waits for this before it starts. */
export type FromBank = { type: "loaded"; track: number } | { type: "refused"; track: number; message: string };

/** What a bank's worklet is built with. */
export interface BankOptions {
  /** engine.wasm's bytes. */
  bytes: ArrayBuffer;
  tracks: number;
}

/** The worklet's registered name. */
export const BANK_PROCESSOR = "engine-bank";
/** Tracks per worklet node (decision 2 of INST-36: about 16, to share the cost of a node). */
export const TRACKS_PER_BANK = 16;
