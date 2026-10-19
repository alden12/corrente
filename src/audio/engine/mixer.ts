/**
 * The mix's Web Audio half, shared by AudioEngine and offline renders so both sum a project the same
 * way: the master bus and the soft clip guarding it, and each track's and group's way into its parent
 * through a delay making up for what's later beside it (INST-36.7, latency.ts).
 */
import { compensate, type MixNode } from "./latency";
import { SOFT_CLIP_RANGE, softClip } from "./softClip";

/**
 * The master bus, through a soft clip to the speakers. It leaves everything under its knee untouched
 * and rounds off what goes past, so a mix too hot for full scale bends rather than crackles (INST-46).
 * There is no hidden limiter before it: as in most DAWs, a loud mix is the meters' to show and a
 * Limiter device's to fix (INST-47), and live, offline and the render core all hear the same thing.
 */
export const masterBus = (context: BaseAudioContext): GainNode => {
  const master = new GainNode(context);
  // A shaper reads its curve over -1..1 and holds the ends past it, so the signal goes in scaled
  // down by the range the curve covers, and the curve scales it back up.
  const scale = new GainNode(context, { gain: 1 / SOFT_CLIP_RANGE });
  const softClip = new WaveShaperNode(context, { curve: softClipCurve(), oversample: "2x" });
  master.connect(scale).connect(softClip).connect(context.destination);
  return master;
};

/** `softClip` over -RANGE..RANGE, as the shaper's -1..1 curve. Fine enough that interpolating it is exact under the knee. */
const softClipCurve = (points = 8193): Float32Array<ArrayBuffer> =>
  Float32Array.from({ length: points }, (_, index) => softClip(((2 * index) / (points - 1) - 1) * SOFT_CLIP_RANGE));

/** The longest delay a compensating DelayNode is made to hold: a second at 48 kHz is plenty. */
export const MAX_COMPENSATION_SECONDS = 1;

/**
 * How long a live change of compensation glides for. A delay that jumps skips or repeats a stretch of
 * sound, which clicks; one that glides bends its pitch for a moment instead. Long enough, too, to
 * cover a device's plan loading a little after its latency changes (EngineDevice waits 40 ms for
 * removed effects to fade out).
 */
export const COMPENSATION_GLIDE_SECONDS = 0.05;

/**
 * Tracks and groups routed into their parents, each through its compensating delay. Live, a change
 * of compensation glides; an offline render sets it once, before it starts.
 */
export class MixRouter {
  private readonly delays = new Map<string, DelayNode>();
  /** Each delay's last setting, so an unchanged one isn't scheduled again on every reconcile. */
  private readonly settings = new Map<string, number>();

  private readonly context: BaseAudioContext;
  /** The bus a child goes into: its group's input, or master. */
  private readonly parentInput: (parentId: string | null) => AudioNode;
  private readonly glide: number;

  constructor(context: BaseAudioContext, parentInput: (parentId: string | null) => AudioNode, glide = 0) {
    this.context = context;
    this.parentInput = parentInput;
    this.glide = glide;
  }

  /** Route a track or group (its last node, `from`) into its parent, through its delay. */
  route(id: string, from: AudioNode, parentId: string | null): void {
    let delay = this.delays.get(id);
    if (!delay) {
      delay = new DelayNode(this.context, { maxDelayTime: MAX_COMPENSATION_SECONDS, delayTime: 0 });
      this.delays.set(id, delay);
      this.settings.set(id, 0);
    }
    from.disconnect();
    from.connect(delay);
    delay.disconnect();
    delay.connect(this.parentInput(parentId));
  }

  /** Set every delay from how late each track's and group's own chain is; how late master's input is in all. */
  compensate(tracks: MixNode[], groups: MixNode[]): number {
    const { delays, total } = compensate(tracks, groups);
    delays.forEach((samples, id) => this.set(id, samples));
    return total;
  }

  /** Set one delay to `samples`, gliding there live. */
  set(id: string, samples: number): void {
    const delay = this.delays.get(id);
    const seconds = Math.min(samples / this.context.sampleRate, MAX_COMPENSATION_SECONDS);
    if (!delay || this.settings.get(id) === seconds) return;
    this.settings.set(id, seconds);
    const now = this.context.currentTime;
    delay.delayTime.cancelScheduledValues(now);
    if (this.glide === 0) {
      delay.delayTime.setValueAtTime(seconds, now);
      return;
    }
    // From where it is now, which may be partway through the last glide.
    delay.delayTime.setValueAtTime(delay.delayTime.value, now);
    delay.delayTime.linearRampToValueAtTime(seconds, now + this.glide);
  }

  /** Drop a track's or group's delay, as it goes. */
  drop(id: string): void {
    this.delays.get(id)?.disconnect();
    this.delays.delete(id);
    this.settings.delete(id);
  }

  dispose(): void {
    [...this.delays.keys()].forEach((id) => this.drop(id));
  }
}
