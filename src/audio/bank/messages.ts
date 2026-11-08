/**
 * What the main thread and an engine bank's worklet say to each other (INST-36.5). Times are
 * AudioContext seconds; a track is the bank's track slot, which is also the node's output index.
 */
import type { CompiledPlan } from "../definitions/compile";
import type { BankSample, LoadOptions } from "./bank";

export type ToBank =
  /** `options`: what carries on from the plan it replaces, and params that ramp in (EngineBank.load). */
  | { type: "load"; track: number; plan: CompiledPlan; values: Record<string, number>; options?: LoadOptions }
  | { type: "unload"; track: number }
  | { type: "noteOn"; track: number; note: number; velocity: number; time: number }
  | { type: "noteOff"; track: number; note: number; time: number }
  /** Let go of every note; `cut`, cut the voices still ringing too (a new play's fresh start). */
  | { type: "allOff"; track: number; time: number; cut?: boolean }
  | { type: "param"; track: number; param: string; value: number; time: number }
  /** The track's MIDI devices as chainWords makes them (INST-11.1): none takes them away. */
  | { type: "midi"; track: number; words: Int32Array }
  /** Move a MIDI device value, numbered as chainWords' `values`, at `time`. */
  | { type: "midiValue"; track: number; value: number; raw: number; time: number }
  /** A sample param now names `ref`, with its audio (none for an empty ref, or one that didn't load). */
  | { type: "sample"; track: number; param: string; ref: string; audio: BankSample | null }
  /** The song's key (DAW-12): a tonic pitch class and its scale as bits. Applies to every track. */
  | ({ type: "key" } & EngineKey)
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

/** The song's key as the engine reads it: the tonic's pitch class (0 = C) and the scale as bits (scaleMask). */
export interface EngineKey {
  tonic: number;
  scale: number;
}

export type FromBank =
  | { type: "loaded"; track: number }
  | { type: "refused"; track: number; message: string }
  /** A sample message has been dealt with (`message` if the sample didn't fit). */
  | { type: "sampled"; track: number; param: string; ref: string; message?: string }
  /**
   * How many blocks over the last second or so took longer to render than they last (INST-36.9):
   * the stalls a bigger output buffer absorbs. Sent only when there were any.
   */
  | { type: "slow"; blocks: number }
  /**
   * The notes a track's voices are sounding now, sent when they change (MOBILE-13): what lights the
   * keys and pads with what the track is playing. Its MIDI devices' notes, or with none, its keys.
   */
  | { type: "sounding"; track: number; notes: number[] };

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

/**
 * The buffers a message can hand over to the worklet rather than copy: a sample map's 16-bit
 * recordings (INST-55), which can be most of a piano. Each once, as `postMessage` asks.
 */
export const transfersOf = (message: ToBank): ArrayBuffer[] =>
  message.type === "sample" && message.audio && "regions" in message.audio
    ? [
        ...new Set(
          message.audio.regions.flatMap((region) =>
            "shorts" in region.audio ? region.audio.shorts.map((shorts) => shorts.buffer as ArrayBuffer) : [],
          ),
        ),
      ]
    : [];
