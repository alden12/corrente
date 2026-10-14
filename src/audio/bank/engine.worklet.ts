/**
 * An engine bank's worklet (INST-36.5): one AudioWorkletNode running up to TRACKS_PER_BANK tracks in
 * one engine, each track on its own stereo output, so the mixer, sends and freezing stay per track.
 * Everything it does is EngineBank's; this only carries messages in and copies each track's block
 * out. `process` creates nothing (garbage collection on the audio thread is a click).
 */
import { EngineBank, PlanRejected } from "./bank";
import { OUTPUT_CHANNELS } from "./exports";
import { BANK_PROCESSOR, type BankOptions, type FromBank, type ToBank } from "./messages";

class EngineBankProcessor extends AudioWorkletProcessor {
  private readonly bank: EngineBank;
  /** Whether each track has a device: an empty one's output is left as the silence it starts as. */
  private readonly loaded: Uint8Array;
  private stopped = false;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    const { bytes, tracks } = options!.processorOptions as BankOptions;
    this.bank = new EngineBank(bytes, sampleRate, tracks);
    this.loaded = new Uint8Array(tracks);
    // What each message does, by type.
    const handlers: { [Type in ToBank["type"]]: (message: Extract<ToBank, { type: Type }>) => void } = {
      load: ({ track, plan, values }) => {
        try {
          this.bank.load(track, plan, values);
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

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // Returning false lets the browser drop the processor.
    if (this.stopped) return false;
    this.bank.process(currentTime);
    // Plain loops: a closure per block would be garbage.
    for (let track = 0; track < outputs.length; track++) {
      if (!this.loaded[track]) continue;
      const channels = outputs[track];
      for (let channel = 0; channel < channels.length && channel < OUTPUT_CHANNELS; channel++)
        channels[channel].set(this.bank.output(track, channel));
    }
    return true;
  }
}

registerProcessor(BANK_PROCESSOR, EngineBankProcessor);
