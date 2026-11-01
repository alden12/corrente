/**
 * Trying a sound in the plugin's window (PLUGIN-3.5): Explore's `SoundPreview` plays through this
 * instead of the app's engine. The sound tried goes to the plugin as `preview`, which plays it in place
 * of the track's until it ends (`null`), without saving it. Notes come from the host as ever, so
 * there's no live target here; samples aren't listed in the plugin, so they don't play.
 */
import type { PackageSamples } from "../audio/bank/devicePackage";
import type { PreviewEngine } from "../audio/live/preview";
import type { InstrumentTrack } from "../audio/project/projectStore";
import { DEFAULT_KEY, type ProjectKey } from "../audio/theory/key";
import { trackPackage, type ToPlugin } from "./pluginDevice";

export class PluginPreview implements PreviewEngine {
  private readonly samples: PackageSamples;
  private readonly send: (message: ToPlugin) => void;
  /** The key a sound's MIDI devices play in: the window's project's. */
  private readonly key: () => ProjectKey;
  /** Counts previews started and ended, so a package that finishes after a newer change is dropped. */
  private turn = 0;

  constructor(samples: PackageSamples, send: (message: ToPlugin) => void, key: () => ProjectKey = () => DEFAULT_KEY) {
    this.samples = samples;
    this.send = send;
    this.key = key;
  }

  setPreview(track: InstrumentTrack | null): void {
    const turn = ++this.turn;
    if (!track) return this.send({ type: "preview", package: null });
    trackPackage(track, this.key(), this.samples)
      ?.then((made) => {
        if (turn === this.turn) this.send({ type: "preview", package: JSON.stringify(made) });
      })
      .catch((error: unknown) => this.send({ type: "log", text: `the sound tried didn't package: ${String(error)}` }));
  }

  getPreviewTarget = () => undefined;
  playSample = async () => null;
  stopSample = () => undefined;
  sampleDuration = async () => null;
}
