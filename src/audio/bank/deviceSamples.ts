/**
 * An engine device's samples (INST-36.6): a sample param names a sample, and each time it changes the
 * sample is decoded here (the worklet can't decode) and sent to the bank, which keeps it in a slot by
 * name. One a wavetable plays is sent as a table, band-limited (render/sampleAudio.ts), under its own
 * name. `ready` waits until the bank has every one, so an offline render doesn't start without them.
 */
import { loadSampleBuffer } from "../samples/builtinUrls";
import { sampleAudioFor, type LoadSample } from "../render/sampleAudio";
import type { SampleAudio } from "./bank";

/** A decoded sample for the bank, under a sample param. */
export interface SampleMessage {
  param: string;
  ref: string;
  audio: SampleAudio | null;
}

export class DeviceSamples {
  private readonly context: BaseAudioContext;
  private readonly send: (message: SampleMessage) => void;
  /** Each sample param's latest sample, done once the bank has it. */
  private readonly requests = new Map<string, { ref: string; done: Promise<void> }>();
  /** What to call when the bank says it has dealt with a param's sample, by param and ref. */
  private readonly answers = new Map<string, () => void>();
  private disposed = false;

  constructor(context: BaseAudioContext, send: (message: SampleMessage) => void) {
    this.context = context;
    this.send = send;
  }

  /**
   * Decode the sample `sampleRef` names and send it for `param`, unless the param has moved on by the
   * time it's decoded. A sample that won't decode is sent as none.
   */
  request(param: string, sampleRef: string, asTable: boolean): void {
    // A table is the bank's own thing, apart from the same sample played as one.
    const ref = sampleRef && asTable ? `table:${sampleRef}` : sampleRef;
    if (this.requests.get(param)?.ref === ref) return;
    const request = { ref, done: Promise.resolve() };
    this.requests.set(param, request);
    const key = answerKey(param, ref);
    let heard: (() => void) | undefined;
    request.done = sampleAudioFor(sampleRef, asTable, browserSample(this.context), this.context.sampleRate)
      .catch((error: unknown) => {
        console.error(`${param}: couldn't load ${sampleRef}`, error);
        return null;
      })
      .then((audio) => {
        if (this.disposed || this.requests.get(param) !== request) return;
        const answered = new Promise<void>((resolve) => this.answers.set(key, (heard = resolve)));
        this.send({ param, ref, audio });
        return answered;
      })
      .finally(() => {
        // Only this request's own: a later one for the same sample may be waiting too.
        if (this.answers.get(key) === heard) this.answers.delete(key);
      });
  }

  /** The bank has dealt with `param`'s sample `ref`. */
  heard(param: string, ref: string): void {
    this.answers.get(answerKey(param, ref))?.();
  }

  /** Resolves once the bank has every sample asked for so far. */
  async ready(): Promise<void> {
    await Promise.all([...this.requests.values()].map((request) => request.done));
  }

  dispose(): void {
    this.disposed = true;
  }
}

const answerKey = (param: string, ref: string) => `${param}\n${ref}`;

/** A sample fetched and decoded by the browser: up to two channels at its own rate, or null for none. */
const browserSample =
  (context: BaseAudioContext): LoadSample =>
  async (ref) => {
    const buffer = await loadSampleBuffer(context, ref);
    return (
      buffer && {
        channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) =>
          buffer.getChannelData(channel).slice(),
        ),
        rate: buffer.sampleRate,
      }
    );
  };
