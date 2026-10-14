/**
 * engine.wasm's exports (INST-36.3), typed, and how to start one. The engine's own notes on each are
 * in engine/src/lib.rs. Shared by the worklet, offline renders and the tests, so all of them drive
 * the engine the same way. No DOM, no Web Audio.
 */

export interface EngineExports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  eng_malloc(bytes: number): number;
  eng_free(pointer: number): void;
  /** Sets the sample rate and the bank's track count; returns the number of block kinds. */
  eng_init(sampleRate: number, tracks: number): number;
  /** 0, or -1 for a bad plan or track, -2 for a plan of the wrong length (the track is unchanged). */
  eng_load(track: number, plan: number, length: number): number;
  eng_set_param(track: number, source: number, value: number): void;
  eng_init_param(track: number, source: number, value: number): void;
  /** `note` is the MIDI note number. */
  eng_note_on(track: number, slot: number, offset: number, frequency: number, velocity: number, note: number): void;
  eng_note_off(track: number, slot: number, offset: number): void;
  /** Fades a slot's voice out over a block from `offset`, then frees it. */
  eng_note_cut(track: number, slot: number, offset: number): void;
  eng_voice_active(track: number, slot: number): number;
  /** The track's voice slots: its plan's voices and a few spares. */
  eng_voice_slots(track: number): number;
  eng_input(track: number, channel: number): number;
  eng_output(track: number, channel: number): number;
  /** Where the transport is at the start of the coming block. */
  eng_transport(beat: number, tempo: number, playing: number): void;
  eng_process(): void;
  eng_track_peak(track: number, channel: number): number;
  eng_track_silent(track: number): number;
  eng_track_latency(track: number): number;
  eng_meter(track: number, section: number, node: number, meter: number): number;
  eng_block_count(): number;
  eng_block_inputs(kind: number): number;
  eng_block_outputs(kind: number): number;
  eng_block_controls(kind: number): number;
  eng_block_meters(kind: number): number;
}

/** Samples in a block: every eng_process renders this many. */
export const BLOCK = 128;
/** Output channels per track (left, right). */
export const OUTPUT_CHANNELS = 2;
/** Audio input channels per track (left, right, sidechain left, sidechain right). */
export const INPUT_CHANNELS = 4;

/**
 * A started engine from engine.wasm's bytes. Compiling synchronously is fine off the main thread (a
 * worklet, a test), and the module is small.
 */
export const startEngine = (bytes: BufferSource): EngineExports => {
  const engine = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports as unknown as EngineExports;
  engine._initialize();
  return engine;
};
