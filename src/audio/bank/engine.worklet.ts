/**
 * An engine bank's worklet (INST-36.5): one AudioWorkletNode running up to TRACKS_PER_BANK tracks in
 * one engine, each track on its own stereo output, so the mixer, sends and freezing stay per track.
 * Everything it does is EngineBank's; this only carries messages in, copies each track's audio
 * input in (a main input and a sidechain per track, INST-36.7), and copies each track's block out. `process` creates nothing (garbage collection on the audio thread is a click).
 */
import { EngineBank, PlanRejected } from "./bank";
import { BLOCK, INPUT_CHANNELS, OUTPUT_CHANNELS } from "./exports";
import { BANK_PROCESSOR, INPUTS_PER_TRACK, type BankOptions, type FromBank, type ToBank } from "./messages";

/**
 * A clock in milliseconds. Not every browser gives a worklet `performance`; `Date.now` only ticks
 * each millisecond, so there a block is only counted slow once it is clearly over (INST-36.9).
 */
const now: () => number =
  typeof globalThis.performance?.now === "function" ? () => globalThis.performance.now() : () => Date.now();

class EngineBankProcessor extends AudioWorkletProcessor {
  private readonly bank: EngineBank;
  /** Whether each track has a device: an empty one's output is left as the silence it starts as. */
  private readonly loaded: Uint8Array;
  private stopped = false;
  /** How long a block lasts, in milliseconds: rendering one takes longer than this and it's late. */
  private readonly budget = (BLOCK / sampleRate) * 1000;
  /** Blocks over budget since the last report, and blocks rendered since then. */
  private slow = 0;
  private counted = 0;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    const { bytes, tracks } = options!.processorOptions as BankOptions;
    this.bank = new EngineBank(bytes, sampleRate, tracks);
    this.loaded = new Uint8Array(tracks);
    // What each message does, by type.
    const handlers: { [Type in ToBank["type"]]: (message: Extract<ToBank, { type: Type }>) => void } = {
      load: ({ track, plan, values, options }) => {
        try {
          this.bank.load(track, plan, values, options);
          this.loaded[track] = 1;
          this.port.postMessage({ type: "loaded", track } satisfies FromBank);
        } catch (error) {
          if (!(error instanceof PlanRejected)) throw error;
          this.port.postMessage({ type: "refused", track, message: error.message } satisfies FromBank);
        }
      },
      unload: ({ track }) => {
        this.bank.unload(track);
        this.loaded[track] = 0;
      },
      noteOn: ({ track, note, velocity, time }) => this.bank.noteOn(track, note, velocity, time),
      noteOff: ({ track, note, time }) => this.bank.noteOff(track, note, time),
      allOff: ({ track, time }) => this.bank.allNotesOff(track, time),
      param: ({ track, param, value, time }) => this.bank.setParam(track, param, value, time),
      sample: ({ track, param, ref, audio }) => {
        try {
          this.bank.setSample(track, param, ref, audio);
          this.port.postMessage({ type: "sampled", track, param, ref } satisfies FromBank);
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          this.port.postMessage({ type: "sampled", track, param, ref, message: error.message } satisfies FromBank);
        }
      },
      transport: ({ time, beat, tempo, playing }) => this.bank.setTransport({ time, beat, tempo, playing }),
      stop: () => (this.stopped = true),
    };
    this.port.onmessage = ({ data }: MessageEvent<ToBank>) => (handlers[data.type] as (message: ToBank) => void)(data);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // Returning false lets the browser drop the processor.
    if (this.stopped) return false;
    // Each track's main input and sidechain into the engine's input channels (0, 1 and 2, 3). An
    // input with nothing connected has no channels: silence.
    for (let track = 0; track < this.loaded.length; track++) {
      if (!this.loaded[track]) continue;
      for (let channel = 0; channel < INPUT_CHANNELS; channel++) {
        const input = inputs[track * INPUTS_PER_TRACK + (channel >> 1)];
        const source = input?.[channel & 1] ?? input?.[0];
        const target = this.bank.input(track, channel);
        if (source) target.set(source);
        else target.fill(0);
      }
    }
    const started = now();
    this.bank.process(currentTime);
    if (now() - started > this.budget) this.slow++;
    this.report();
    // Plain loops: a closure per block would be garbage.
    for (let track = 0; track < outputs.length; track++) {
      if (!this.loaded[track]) continue;
      const channels = outputs[track];
      for (let channel = 0; channel < channels.length && channel < OUTPUT_CHANNELS; channel++)
        channels[channel].set(this.bank.output(track, channel));
    }
    return true;
  }

  /** About once a second, say how many blocks were slow, if any were. */
  private report(): void {
    if (++this.counted * this.budget < 1000) return;
    if (this.slow > 0) this.port.postMessage({ type: "slow", blocks: this.slow } satisfies FromBank);
    this.slow = this.counted = 0;
  }
}

registerProcessor(BANK_PROCESSOR, EngineBankProcessor);
