/**
 * Live levels for the meters (DAW-8.5): how loud each track, group and the master are right now, read
 * by the UI once a frame. A meter is two AnalyserNodes behind a channel splitter, so a sound panned
 * hard to one side reads its own level rather than half of it, made the first time something asks
 * for that id's level: nothing is measured that no meter shows.
 *
 * **Re-attached on every route.** The mix router disconnects a node before connecting it to its
 * parent (mixer.ts `route`), which cuts every other connection too, the meter's included. So the
 * engine hands each routed node back here (`attach`), and the meter is wired to it again.
 *
 * A level is the loudest sample over the analyser's window (about 43 ms at 48 kHz, longer than a
 * frame, so no peak falls between two reads), as a gain: 1 is full scale (0 dBFS).
 */

/** Samples each analyser looks back over: about 43 ms at 48 kHz, longer than a frame at 30 fps. */
const WINDOW = 2048;

interface Meter {
  source: AudioNode;
  splitter: ChannelSplitterNode;
  channels: [AnalyserNode, AnalyserNode];
}

export class LevelMeters {
  private readonly meters = new Map<string, Meter>();
  private readonly buffer = new Float32Array(WINDOW);
  private readonly context: BaseAudioContext;

  constructor(context: BaseAudioContext) {
    this.context = context;
  }

  /** `id`'s node was (re)routed: hang its meter back on, if it has one. */
  attach(id: string, source: AudioNode): void {
    const meter = this.meters.get(id);
    if (!meter) return;
    if (meter.source !== source) meter.source = source;
    source.connect(meter.splitter);
  }

  /** The loudest sample of each channel just now, measuring `source` under `id` from this read on. */
  levels(id: string, source: AudioNode | undefined): [number, number] {
    if (!source) {
      this.drop(id);
      return [0, 0];
    }
    const meter = this.meters.get(id) ?? this.make(id, source);
    if (meter.source !== source) this.attach(id, source);
    return [this.peak(meter.channels[0]), this.peak(meter.channels[1])];
  }

  /** Stop measuring `id` (its track or group went). */
  drop(id: string): void {
    const meter = this.meters.get(id);
    if (!meter) return;
    try {
      meter.source.disconnect(meter.splitter);
    } catch {
      // Already cut off, by its node's own disconnect when it went.
    }
    meter.splitter.disconnect();
    this.meters.delete(id);
  }

  /** Stop measuring everything not in `ids`. */
  keep(ids: ReadonlySet<string>): void {
    [...this.meters.keys()].filter((id) => !ids.has(id)).forEach((id) => this.drop(id));
  }

  private make(id: string, source: AudioNode): Meter {
    const splitter = new ChannelSplitterNode(this.context, { numberOfOutputs: 2 });
    const analyser = () => new AnalyserNode(this.context, { fftSize: WINDOW, smoothingTimeConstant: 0 });
    const channels: [AnalyserNode, AnalyserNode] = [analyser(), analyser()];
    channels.forEach((channel, index) => splitter.connect(channel, index));
    source.connect(splitter);
    const meter = { source, splitter, channels };
    this.meters.set(id, meter);
    return meter;
  }

  private peak(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.buffer);
    let loudest = 0;
    for (const sample of this.buffer) loudest = Math.max(loudest, Math.abs(sample));
    return loudest;
  }
}
