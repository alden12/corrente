/**
 * A bank of tracks in one engine (INST-36.5): the JavaScript that sits next to engine.wasm on the
 * audio thread. It loads each track's compiled plan, keeps the timed events, picks voice slots, and
 * plays each event at its sample in the block that contains it. The worklet wraps it, and offline
 * renders and the tests run it as is, so all of them play the same way. No DOM, no Web Audio.
 *
 * - **Times are AudioContext seconds.** A note lands on its exact sample; a param move lands at the
 *   start of its block and the engine ramps it across that block (about 3 ms).
 * - **Params are set by name**, with the raw value the param store holds: each binding's table,
 *   scale and offset turn it into what its engine source gets, here as the event is added rather
 *   than while rendering.
 * - **`process` creates nothing**: events, voices and the views of the engine's memory are all made
 *   ahead (decision 4 of INST-36). The memory only grows on init and load, so views are re-made
 *   then (the addresses the engine gave stay put).
 */
import type { CompiledPlan } from "../definitions/compile";
import { resolveNumber } from "../graph/table";
import { BLOCK, INPUT_CHANNELS, OUTPUT_CHANNELS, startEngine, type EngineExports } from "./exports";
import { EVENT, EventQueue, type TimedEvent } from "./events";
import { VoiceAllocator } from "./voices";

/** A plan the engine refused: the code from eng_load (-1 a bad plan, -2 the wrong length). */
export class PlanRejected extends Error {
  readonly code: number;
  constructor(track: number, code: number) {
    super(`track ${track}: the engine refused the plan (${code})`);
    this.code = code;
  }
}

const frequencyOf = (note: number) => 440 * 2 ** ((note - 69) / 12);

interface Track {
  plan: CompiledPlan | null;
  voices: VoiceAllocator;
  /** Whether the engine has a slot busy, made once so note ons create no closure. */
  sounding: (slot: number) => boolean;
  /** The raw value of each param, kept so a new plan starts where the knobs are. */
  values: Record<string, number>;
}

export class EngineBank {
  readonly engine: EngineExports;
  readonly sampleRate: number;
  readonly trackCount: number;
  private readonly queue = new EventQueue();
  private readonly tracks: Track[];
  private outputs: Float32Array[][] = [];
  private inputs: Float32Array[][] = [];
  /** What each event kind does, by kind; bound once. */
  private readonly play: ((event: TimedEvent, offset: number) => void)[];

  constructor(bytes: BufferSource, sampleRate: number, trackCount: number) {
    this.sampleRate = sampleRate;
    this.trackCount = trackCount;
    this.engine = startEngine(bytes);
    this.engine.eng_init(sampleRate, trackCount);
    this.tracks = Array.from({ length: trackCount }, (_, index) => ({
      plan: null,
      voices: new VoiceAllocator(0),
      sounding: (slot: number) => this.engine.eng_voice_active(index, slot) === 1,
      values: {},
    }));
    this.play = [];
    this.play[EVENT.noteOn] = (event, offset) => this.playNoteOn(event, offset);
    this.play[EVENT.noteOff] = (event, offset) => this.playNoteOff(event, offset);
    this.play[EVENT.param] = (event) => this.engine.eng_set_param(event.track, event.target, event.value);
    this.play[EVENT.allOff] = (event, offset) => this.playAllOff(event, offset);
    this.view();
  }

  /**
   * Play a compiled plan on a track, its params starting at `values` (by name; any left out keep
   * the value they had, or 0). Sounding notes are cut, and the track's queued events dropped.
   */
  load(track: number, plan: CompiledPlan, values: Record<string, number> = {}): void {
    const state = this.trackAt(track);
    const pointer = this.engine.eng_malloc(plan.words.length * 4);
    new Int32Array(this.engine.memory.buffer, pointer, plan.words.length).set(plan.words);
    const code = this.engine.eng_load(track, pointer, plan.words.length);
    this.engine.eng_free(pointer);
    this.view();
    if (code !== 0) throw new PlanRejected(track, code);
    state.plan = plan;
    state.voices = new VoiceAllocator(plan.voices);
    state.values = { ...state.values, ...values };
    plan.params.forEach((source, index) =>
      this.engine.eng_init_param(track, index, resolveNumber(state.values[source.param] ?? 0, source)),
    );
    this.queue.clear(track);
  }

  noteOn(track: number, note: number, velocity: number, time: number): void {
    this.queue.add(EVENT.noteOn, track, note, velocity, time);
  }

  noteOff(track: number, note: number, time: number): void {
    this.queue.add(EVENT.noteOff, track, note, 0, time);
  }

  /** Release every held note on a track. */
  allNotesOff(track: number, time: number): void {
    this.queue.add(EVENT.allOff, track, 0, 0, time);
  }

  /** Move a param (its raw value, by name) at `time`. A param the plan doesn't read is kept for the next. */
  setParam(track: number, param: string, value: number, time: number): void {
    const state = this.trackAt(track);
    state.values[param] = value;
    state.plan?.params.forEach((source, index) => {
      if (source.param === param) this.queue.add(EVENT.param, track, index, resolveNumber(value, source), time);
    });
  }

  /** Render the block starting at `time` (seconds): play its events, then every track. */
  process(time: number): void {
    const end = time + BLOCK / this.sampleRate;
    for (let event = this.queue.next(end); event; event = this.queue.next(end)) {
      const offset = Math.min(BLOCK - 1, Math.max(0, Math.round((event.time - time) * this.sampleRate)));
      this.play[event.kind](event, offset);
    }
    this.engine.eng_process();
  }

  /** A track's output channel (0 left, 1 right) for the block just rendered. Read it, don't keep it. */
  output(track: number, channel: number): Float32Array {
    return this.outputs[track][channel];
  }

  /** A track's audio input channel, to fill before `process`: left, right, sidechain left and right. */
  input(track: number, channel: number): Float32Array {
    return this.inputs[track][channel];
  }

  /** Whether a track made no sound in the last block and has no voice sounding (DAW-57). */
  silent(track: number): boolean {
    return this.engine.eng_track_silent(track) === 1;
  }

  /** Voices sounding on a track, releases included. */
  activeVoices(track: number): number {
    const state = this.trackAt(track);
    let active = 0;
    for (let slot = 0; slot < state.voices.count; slot++) if (state.sounding(slot)) active++;
    return active;
  }

  private playNoteOn(event: TimedEvent, offset: number): void {
    const state = this.tracks[event.track];
    if (!state) return;
    const slot = state.voices.noteOn(event.target, event.time, state.sounding);
    if (slot >= 0) this.engine.eng_note_on(event.track, slot, offset, frequencyOf(event.target), event.value);
  }

  private playNoteOff(event: TimedEvent, offset: number): void {
    const state = this.tracks[event.track];
    if (!state) return;
    const slot = state.voices.noteOff(event.target, event.time);
    if (slot >= 0) this.engine.eng_note_off(event.track, slot, offset);
  }

  private playAllOff(event: TimedEvent, offset: number): void {
    const { track } = event;
    const state = this.tracks[track];
    if (!state) return;
    for (let slot = 0; slot < state.voices.count; slot++) {
      if (!state.voices.isHeld(slot)) continue;
      state.voices.releaseSlot(slot, event.time);
      this.engine.eng_note_off(track, slot, offset);
    }
  }

  private trackAt(track: number): Track {
    const state = this.tracks[track];
    if (!state) throw new RangeError(`there is no track ${track} (the bank has ${this.trackCount})`);
    return state;
  }

  /** View the engine's input and output buffers again: memory may have grown, replacing its buffer. */
  private view(): void {
    const { engine } = this;
    const channels = (count: number, address: (track: number, channel: number) => number) =>
      Array.from({ length: this.trackCount }, (_, track) =>
        Array.from(
          { length: count },
          (_, channel) => new Float32Array(engine.memory.buffer, address(track, channel), BLOCK),
        ),
      );
    this.outputs = channels(OUTPUT_CHANNELS, (track, channel) => engine.eng_output(track, channel));
    this.inputs = channels(INPUT_CHANNELS, (track, channel) => engine.eng_input(track, channel));
  }
}
