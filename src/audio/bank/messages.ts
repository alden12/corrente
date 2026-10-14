/**
 * What the main thread and an engine bank's worklet say to each other (INST-36.5). Times are
 * AudioContext seconds; a track is the bank's track slot, which is also the node's output index.
 */
import type { CompiledPlan } from "../definitions/compile";
import type { LoadOptions, SampleAudio } from "./bank";

export type ToBank =
  /** `options`: what carries on from the plan it replaces, and params that ramp in (EngineBank.load). */
  | { type: "load"; track: number; plan: CompiledPlan; values: Record<string, number>; options?: LoadOptions }
  | { type: "unload"; track: number }
  | { type: "noteOn"; track: number; note: number; velocity: number; time: number }
  | { type: "noteOff"; track: number; note: number; time: number }
  | { type: "allOff"; track: number; time: number }
  | { type: "param"; track: number; param: string; value: number; time: number }
  /** A sample param now names `ref`, with its audio (none for an empty ref, or one that didn't load). */
  | { type: "sample"; track: number; param: string; ref: string; audio: SampleAudio | null }
  /** Where the transport is: `beat` at context time `time`, at `tempo`. Applies to every track. */
  | ({ type: "transport" } & Transport)
  /** The bank is going: disconnecting a worklet node doesn't stop it, so it stops itself. */
  | { type: "stop" };

/** Whether a track's plan is with the engine now: an offline render waits for this before it starts. */
/**
 * The transport as a point to count from: at context time `time` it was at `beat` (counted from where
 * it started), moving at `tempo` beats a minute. While stopped the beat runs on, so a synced LFO keeps
 * moving; `playing` says which.
 */
export interface Transport {
  time: number;
  beat: number;
  tempo: number;
  playing: boolean;
}

export type FromBank =
  | { type: "loaded"; track: number }
  | { type: "refused"; track: number; message: string }
  /** A sample message has been dealt with (`message` if the sample didn't fit). */
  | { type: "sampled"; track: number; param: string; ref: string; message?: string };

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
/** Node inputs per track: its main input (left, right), then its sidechain (left, right). */
export const INPUTS_PER_TRACK = 2;
