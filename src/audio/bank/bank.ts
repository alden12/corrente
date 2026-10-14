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
import type { CompiledPlan, PlanZone } from "../definitions/compile";
import { resolveNumber } from "../graph/table";
import {
  BLOCK,
  EMPTY_SAMPLE,
  INPUT_CHANNELS,
  OUTPUT_CHANNELS,
  startEngine,
  ZONE_SIGNAL,
  type EngineExports,
} from "./exports";
import { carriesVoices } from "./carry";
import { EVENT, EventQueue, type TimedEvent } from "./events";
import type { Transport } from "./messages";
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

/**
 * The first of a plan's zones a note fits, by key and velocity. A plain indexed loop: it runs while
 * rendering, where a closure or an iterator would be garbage.
 */
const zoneFor = (zones: PlanZone[], note: number, velocity: number): PlanZone | undefined => {
  for (let index = 0; index < zones.length; index++) {
    const zone = zones[index];
    const [lowKey, highKey] = zone.keys;
    const [lowVelocity, highVelocity] = zone.velocities;
    if (note >= lowKey && note <= highKey && velocity >= lowVelocity && velocity <= highVelocity) return zone;
  }
  return undefined;
};

/** A plan with nothing in it: no nodes, no steps, no outputs. What a free track plays. */
const EMPTY_PLAN = Int32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

interface Track {
  plan: CompiledPlan | null;
  voices: VoiceAllocator;
  /** Whether the engine has a slot busy, made once so note ons create no closure. */
  sounding: (slot: number) => boolean;
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
  /** What each event kind does, by kind; bound once. */
  private readonly play: ((event: TimedEvent, offset: number) => void)[];

  constructor(bytes: BufferSource, sampleRate: number, trackCount: number) {
    this.sampleRate = sampleRate;
    this.trackCount = trackCount;
    this.engine = startEngine(bytes);
    this.engine.eng_init(sampleRate, trackCount);
    this.tracks = Array.from({ length: trackCount }, (_, index) => ({
      plan: null,
      voices: new VoiceAllocator(0, 0),
      sounding: (slot: number) => this.engine.eng_voice_active(index, slot) === 1,
      values: {},
      samples: {},
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
    const carried =
      carry !== undefined &&
      this.withWords(carry, (pointer) => this.engine.eng_carry(track, pointer, carry.length)) >= 0;
    const voicesCarried = carried && carriesVoices(carry);
    const held = voicesCarried ? [] : state.voices.heldNotes();
    state.plan = plan;
    // Voices that carry on keep their slots, so the allocator that placed them stays.
    if (!voicesCarried) state.voices = new VoiceAllocator(this.engine.eng_voice_slots(track), plan.voices);
    state.values = { ...state.values, ...values };
    plan.params.forEach((source, index) => {
      if (source.sample) {
        this.engine.eng_init_param(track, index, state.values[source.param] ?? EMPTY_SAMPLE);
        return;
      }
      const value = resolveNumber(state.values[source.param] ?? 0, source);
      const start = from[source.param];
      this.engine.eng_init_param(track, index, start === undefined ? value : resolveNumber(start, source));
      if (start !== undefined) this.engine.eng_set_param(track, index, value);
    });
    held.forEach(({ note, velocity }) => this.startNote(track, note, velocity, 0, 0));
  }

  /** Copy `words` into the engine's memory for `call`, then free them. */
  private withWords(words: Int32Array, call: (pointer: number) => number): number {
    const pointer = this.engine.eng_malloc(words.length * 4);
    new Int32Array(this.engine.memory.buffer, pointer, words.length).set(words);
    const result = call(pointer);
    this.engine.eng_free(pointer);
    this.view();
    return result;
  }

  /** Empty a track (its device went): it plays nothing, its queued events and knob values are dropped. */
  unload(track: number): void {
    const state = this.trackAt(track);
    this.withWords(EMPTY_PLAN, (pointer) => this.engine.eng_load(track, pointer, EMPTY_PLAN.length));
    state.plan = null;
    state.voices = new VoiceAllocator(0, 0);
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
    state.plan?.params.forEach((source, index) => {
      if (source.param === param) this.engine.eng_init_param(track, index, slot);
    });
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
    const state = this.trackAt(track);
    state.values[param] = value;
    state.plan?.params.forEach((source, index) => {
      if (source.param === param && !source.sample)
        this.queue.add(EVENT.param, track, index, resolveNumber(value, source), time);
    });
  }

  /**
   * Where the transport is from now on (`beat` at context time `time`), for the host signals every
   * plan can read: tempo, beat, playing. Takes effect from the block it lands in.
   */
  setTransport(transport: Transport): void {
    this.transport = { ...transport };
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
    const state = this.trackAt(track);
    let active = 0;
    for (let slot = 0; slot < state.voices.slots; slot++) if (state.sounding(slot)) active++;
    return active;
  }

  private playNoteOn(event: TimedEvent, offset: number): void {
    this.startNote(event.track, event.target, event.value, event.time, offset);
  }

  /**
   * Start a note in a voice slot, cutting the voice it steals, `offset` samples into the coming
   * block. With zones, the note takes the first that fits and its voice is told which, and a note no
   * zone fits doesn't sound (or take a voice).
   */
  private startNote(track: number, note: number, velocity: number, time: number, offset: number): void {
    const state = this.tracks[track];
    if (!state || state.voices.slots === 0) return;
    const zones = state.plan?.zones;
    const zone = zones && zoneFor(zones, note, velocity);
    if (zones && !zone) return;
    const slot = state.voices.noteOn(note, velocity, time, state.sounding);
    if (state.voices.cut >= 0) this.engine.eng_note_cut(track, state.voices.cut, offset);
    this.engine.eng_note_on(track, slot, offset, frequencyOf(note), velocity, note);
    if (!zone) return;
    this.engine.eng_voice_signal(track, slot, ZONE_SIGNAL.sample, state.values[zone.param] ?? EMPTY_SAMPLE);
    this.engine.eng_voice_signal(track, slot, ZONE_SIGNAL.root, zone.root);
    this.engine.eng_voice_signal(track, slot, ZONE_SIGNAL.start, zone.start);
    this.engine.eng_voice_signal(track, slot, ZONE_SIGNAL.end, zone.end);
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
    for (let slot = 0; slot < state.voices.slots; slot++) {
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
