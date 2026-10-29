/**
 * A bank of tracks in one engine (INST-36.5): the JavaScript that sits next to engine.wasm on the
 * audio thread. It loads each track's compiled plan, keeps the timed events, and plays each event at
 * its sample in the block that contains it. Which voice slot a note takes, its sample zone and each
 * param's shaping are the engine's (ARCH-10.1), so a native host plays the same without this file. The worklet wraps it, and offline
 * renders and the tests run it as is, so all of them play the same way. No DOM, no Web Audio.
 *
 * - **Times are AudioContext seconds.** A note lands on its exact sample; a param move lands at the
 *   start of its block and the engine ramps it across that block (about 3 ms).
 * - **Params are set by name**, with the raw value the param store holds; the engine shapes it for
 *   each source that reads it (binding.ts numbers the names).
 * - **Edits don't click.** A new plan crossfades in over a block in the engine, and the notes held
 *   start again in it; a voice stolen for a new note fades out while the note starts in a spare slot.
 *   Or, told which of the old plan carries on (INST-36.7, carry.ts), the new plan takes over those
 *   nodes' state, and its voices too if they carry: then held notes play on rather than start again.
 * - **Samples are shared by name** (INST-36.6): a sample param's value is a ref, and the bank keeps
 *   each ref it's given in one engine slot however many tracks play it, freeing it when the last
 *   stops. The param's engine value is the slot, set at once rather than ramped.
 * - **`process` creates nothing**: events, voices and the views of the engine's memory are all made
 *   ahead (decision 4 of INST-36). The memory only grows on init, load and loading a sample, so
 *   views are re-made then (the addresses the engine gave stay put).
 */
import type { CompiledPlan } from "../definitions/compile";
import { bindingOf, bindWords } from "./binding";
import {
  BLOCK,
  EMPTY_SAMPLE,
  INPUT_CHANNELS,
  OUTPUT_CHANNELS,
  startEngine,
  withWords,
  type EngineExports,
} from "./exports";
import { EVENT, EventQueue, type TimedEvent } from "./events";
import type { EngineKey, Transport } from "./messages";

/** A plan the engine refused: the code from eng_load (-1 a bad plan, -2 the wrong length). */
export class PlanRejected extends Error {
  readonly code: number;
  constructor(track: number, code: number) {
    super(`track ${track}: the engine refused the plan (${code})`);
    this.code = code;
  }
}

/** A plan with nothing in it: no nodes, no steps, no outputs. What a free track plays. */
const EMPTY_PLAN = Int32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
/** Its binding: no values, no sources, no zones (binding.ts's words, as doubles). */
const EMPTY_BINDING = new Int32Array(new Float64Array([0, 0, 0, 0]).buffer);
/** A MIDI chain with no values and no devices (chainWords([])), written out so the worklet needn't load the compiler. */
const EMPTY_CHAIN = new Int32Array(new Float64Array([0, 0]).buffer);

interface Track {
  plan: CompiledPlan | null;
  /** The raw value of each param, kept so a new plan starts where the knobs are. */
  values: Record<string, number>;
  /** The sample each sample param names, by param. */
  samples: Record<string, string>;
}

/** Audio for a sample: one or two channels of the same length, at its own rate. */
export interface SampleAudio {
  channels: Float32Array[];
  rate: number;
}

/** How a plan loads, beyond its values (`EngineBank.load`). */
export interface LoadOptions {
  carry?: Int32Array;
  from?: Record<string, number>;
}

export class EngineBank {
  readonly engine: EngineExports;
  readonly sampleRate: number;
  readonly trackCount: number;
  private readonly queue = new EventQueue();
  /** The transport to count the beat from: stopped at 120 until told otherwise. */
  private transport: Transport = { time: 0, beat: 0, tempo: 120, playing: false };
  private readonly tracks: Track[];
  /** Each sample loaded, by ref: its slot, and how many sample params name it. */
  private readonly sampleSlots = new Map<string, { slot: number; users: number }>();
  private outputs: Float32Array[][] = [];
  private inputs: Float32Array[][] = [];
  /**
   * Param names by number, for queued param events: they name the param, not its place in a plan,
   * since the plan can be reloaded before they play.
   */
  private readonly paramNames: string[] = [];
  private readonly paramIds = new Map<string, number>();
  /** What each event kind does, by kind; bound once. */
  private readonly play: ((event: TimedEvent, offset: number) => void)[];

  constructor(bytes: BufferSource, sampleRate: number, trackCount: number) {
    this.sampleRate = sampleRate;
    this.trackCount = trackCount;
    this.engine = startEngine(bytes);
    this.engine.eng_init(sampleRate, trackCount);
    this.tracks = Array.from({ length: trackCount }, () => ({ plan: null, values: {}, samples: {} }));
    this.play = [];
    this.play[EVENT.noteOn] = (event, offset) => this.playNoteOn(event, offset);
    this.play[EVENT.noteOff] = (event, offset) => this.playNoteOff(event, offset);
    this.play[EVENT.param] = (event) => this.playParam(event);
    this.play[EVENT.allOff] = (event, offset) => this.playAllOff(event, offset);
    this.play[EVENT.midiValue] = (event) => this.engine.eng_midi_value(event.track, event.target, event.value);
    this.view();
  }

  /**
   * Play a compiled plan on a track, its params starting at `values` (by name; any left out keep
   * the value they had, or 0). The old plan fades out over a block with the notes it was releasing;
   * the notes held start again in the new one. Queued events still play, in the new plan.
   *
   * With `carry` (carry.ts, against the plan this track has now), the nodes it names carry on
   * instead, with no fade; if the voices carry, the notes play on in them. Words that don't fit are
   * ignored, and the plan loads as without them. Params in `from` start there and ramp to their
   * value over the first block: how an effect added to a chain fades in from bypassed.
   */
  load(track: number, plan: CompiledPlan, values: Record<string, number> = {}, options: LoadOptions = {}): void {
    const { carry, from = {} } = options;
    const state = this.trackAt(track);
    const code = this.withWords(plan.words, (pointer) => this.engine.eng_load(track, pointer, plan.words.length));
    if (code !== 0) throw new PlanRejected(track, code);
    if (carry !== undefined) this.withWords(carry, (pointer) => this.engine.eng_carry(track, pointer, carry.length));
    state.plan = plan;
    state.values = { ...state.values, ...values };
    // The engine sets every param from the values and starts the held notes again (unless they carried on).
    const bound = bindWords(plan, state.values, from);
    const bindCode = this.withWords(bound, (pointer) => this.engine.eng_bind(track, pointer, bound.length));
    if (bindCode !== 0) throw new PlanRejected(track, bindCode);
  }

  /**
   * Play a track's notes through MIDI devices (INST-11.1): `words` are chainWords' words, the devices
   * in order (none takes them away). Takes effect at once; the keys down start again in it. Throws
   * PlanRejected if the engine won't read them.
   */
  loadMidi(track: number, words: Int32Array): void {
    this.trackAt(track);
    const code = this.withWords(words, (pointer) => this.engine.eng_midi_load(track, pointer, words.length));
    if (code !== 0) throw new PlanRejected(track, code);
  }

  /**
   * The notes a track's MIDI devices played into its voices in the last block, in order: each its
   * offset into the block, its note, and its velocity, 0 for a note off. For drawing what a device
   * plays (its portrait), not for playing: it makes a list.
   */
  midiPlayed(track: number): { offset: number; note: number; velocity: number }[] {
    this.trackAt(track);
    const words = new Float32Array(
      this.engine.memory.buffer,
      this.engine.eng_midi_played(track),
      this.engine.eng_midi_played_count(track) * 3,
    );
    return Array.from({ length: words.length / 3 }, (_, at) => ({
      offset: words[at * 3],
      note: words[at * 3 + 1],
      velocity: words[at * 3 + 2],
    }));
  }

  /** Move a MIDI device value (numbered as chainWords' `values`) at `time`. */
  setMidiValue(track: number, value: number, raw: number, time: number): void {
    this.queue.add(EVENT.midiValue, track, value, raw, time);
  }

  /** Copy `words` into the engine's memory for `call`, then free them. Loading can grow the memory. */
  private withWords(words: Int32Array, call: (pointer: number) => number): number {
    const result = withWords(this.engine, words, call);
    this.view();
    return result;
  }

  /** Empty a track (its device went): it plays nothing, through no MIDI devices, and its queued events and knob values are dropped. */
  unload(track: number): void {
    const state = this.trackAt(track);
    this.withWords(EMPTY_CHAIN, (pointer) => this.engine.eng_midi_load(track, pointer, EMPTY_CHAIN.length));
    this.withWords(EMPTY_PLAN, (pointer) => this.engine.eng_load(track, pointer, EMPTY_PLAN.length));
    this.withWords(EMPTY_BINDING, (pointer) => this.engine.eng_bind(track, pointer, EMPTY_BINDING.length));
    state.plan = null;
    state.values = {};
    Object.values(state.samples).forEach((ref) => this.releaseSample(ref));
    state.samples = {};
    this.queue.clear(track);
  }

  /**
   * Point a track's sample param at a sample: `ref` names it, and `audio` is what to load if the bank
   * doesn't have it yet (null, or an empty ref, for none). Takes effect at once. Throws a RangeError,
   * leaving the param as it was, if the sample is too big or every slot is taken.
   */
  setSample(track: number, param: string, ref: string, audio: SampleAudio | null): void {
    const state = this.trackAt(track);
    const previous = state.samples[param];
    const slot = ref ? this.holdSample(ref, audio) : EMPTY_SAMPLE;
    if (previous !== undefined) this.releaseSample(previous);
    if (slot === EMPTY_SAMPLE) delete state.samples[param];
    else state.samples[param] = ref;
    state.values[param] = slot;
    const value = state.plan && bindingOf(state.plan).numbers.get(param);
    if (value !== undefined && value !== null) this.engine.eng_init_value(track, value, slot);
  }

  /**
   * The slot `ref` is in, loading `audio` into a free one first if it isn't loaded, counting one more
   * user. The empty slot if it isn't loaded and there's no audio.
   */
  private holdSample(ref: string, audio: SampleAudio | null): number {
    const held = this.sampleSlots.get(ref);
    if (held) {
      held.users++;
      return held.slot;
    }
    if (!audio) return EMPTY_SAMPLE;
    const taken = new Set([...this.sampleSlots.values()].map((entry) => entry.slot));
    const slot = Array.from({ length: EMPTY_SAMPLE }, (_, index) => index).find((index) => !taken.has(index));
    if (slot === undefined) throw new RangeError(`every sample slot is taken (${EMPTY_SAMPLE})`);
    this.loadSample(slot, audio.channels, audio.rate);
    this.sampleSlots.set(ref, { slot, users: 1 });
    return slot;
  }

  /** One fewer user of `ref`; the last frees its slot. */
  private releaseSample(ref: string): void {
    const held = this.sampleSlots.get(ref);
    if (!held) return;
    held.users--;
    if (held.users > 0) return;
    this.freeSample(held.slot);
    this.sampleSlots.delete(ref);
  }

  /** How many samples the bank holds, for tests. */
  get samplesHeld(): number {
    return this.sampleSlots.size;
  }

  /**
   * Put a sample in one of the engine's sample slots (0 to 255), replacing any there: one or two
   * channels of the same length, at the sample's own rate. A sampler names its slot, and plays it at
   * any track's notes (INST-36.6). `setSample` is the way in by name; this is the slot itself.
   */
  loadSample(slot: number, channels: Float32Array[], rate: number): void {
    const frames = channels[0]?.length ?? 0;
    const even = channels.every((channel) => channel.length === frames);
    const pointer = even ? this.engine.eng_sample_reserve(slot, frames, channels.length, rate) : 0;
    if (pointer === 0) {
      throw new RangeError(
        `sample slot ${slot}: ${channels.length} channels of ${frames} frames at ${rate} Hz don't fit (0 to 255, one or two channels of the same length, up to 2^24 floats)`,
      );
    }
    const data = new Float32Array(this.engine.memory.buffer, pointer, frames * channels.length);
    channels.forEach((channel, index) => data.set(channel, index * frames));
    this.view();
  }

  /** Empty a sample slot. A sampler still naming it plays silence. */
  freeSample(slot: number): void {
    this.engine.eng_sample_free(slot);
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

  /**
   * Move a param (its raw value, by name) at `time`. A param the plan doesn't read is kept for the
   * next. Sample params go through `setSample`.
   */
  setParam(track: number, param: string, value: number, time: number): void {
    this.trackAt(track).values[param] = value;
    this.queue.add(EVENT.param, track, this.paramId(param), value, time);
  }

  /** A param name's number, for the queue. */
  private paramId(param: string): number {
    const known = this.paramIds.get(param);
    if (known !== undefined) return known;
    this.paramIds.set(param, this.paramNames.length);
    return this.paramNames.push(param) - 1;
  }

  /** A queued param move, to the plan loaded now if it reads the param. */
  private playParam(event: TimedEvent): void {
    const { plan } = this.trackAt(event.track);
    const value = plan && bindingOf(plan).numbers.get(this.paramNames[event.target]);
    if (value !== undefined && value !== null) this.engine.eng_set_value(event.track, value, event.value);
  }

  /**
   * Where the transport is from now on (`beat` at context time `time`), for the host signals every
   * plan can read: tempo, beat, playing. Takes effect from the block it lands in.
   */
  setTransport(transport: Transport): void {
    this.transport = { ...transport };
  }

  /** The song's key from the next block on, for the MIDI nodes that work in degrees. */
  setKey({ tonic, scale }: EngineKey): void {
    this.engine.eng_key(tonic, scale);
  }

  /** Render the block starting at `time` (seconds): play its events, then every track. */
  process(time: number): void {
    const { beat, tempo, playing } = this.transport;
    this.engine.eng_transport(beat + ((time - this.transport.time) * tempo) / 60, tempo, playing ? 1 : 0);
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
    this.trackAt(track);
    let active = 0;
    for (let slot = 0; slot < this.engine.eng_voice_slots(track); slot++)
      active += this.engine.eng_voice_active(track, slot);
    return active;
  }

  private playNoteOn(event: TimedEvent, offset: number): void {
    this.engine.eng_key_on(event.track, offset, event.target, event.value);
  }

  private playNoteOff(event: TimedEvent, offset: number): void {
    this.engine.eng_key_off(event.track, offset, event.target);
  }

  private playAllOff(event: TimedEvent, offset: number): void {
    this.engine.eng_keys_off(event.track, offset);
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
