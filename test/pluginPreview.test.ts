import { describe, expect, it } from "vitest";
import type { DevicePackage, PackageSamples } from "../src/audio/bank/devicePackage";
import { catalogEntry, DEFAULT_INSTRUMENT, pickableInstrumentInfos } from "../src/audio/instruments/catalog";
import { SoundPreview } from "../src/audio/live/preview";
import { instrumentSound } from "../src/audio/patches/sound";
import type { ToPlugin } from "../src/plugin/pluginDevice";
import { PluginPreview } from "../src/plugin/pluginPreview";

/**
 * Trying a sound in the plugin's window (PLUGIN-3.5): Explore's preview sends the sound to the plugin
 * as `preview`, and `null` when the trying ends, so the plugin plays the track's sound again.
 */

const samples: PackageSamples = {
  file: async (ref) => new TextEncoder().encode(ref),
  table: async () => Float32Array.from([0.5, -0.5]),
};

/** Another instrument than the window starts with, to try. */
const other = pickableInstrumentInfos().find((info) => info.type !== DEFAULT_INSTRUMENT)!.type;

const tried = () => {
  const sent: ToPlugin[] = [];
  const preview = new SoundPreview(new PluginPreview(samples, (message) => sent.push(message)));
  return { sent, preview };
};

/** Let the package being built finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PluginPreview", () => {
  it("sends the sound tried as a package, and null when the trying ends", async () => {
    const { sent, preview } = tried();
    preview.open("instrument:" + other, instrumentSound(other, "Tried"));
    await settle();
    const [message] = sent;
    expect(message?.type).toBe("preview");
    const made = JSON.parse((message as { package: string }).package) as DevicePackage;
    expect(made.label).toBe(catalogEntry(other).label);
    preview.close();
    expect(sent.at(-1)).toEqual({ type: "preview", package: null });
  });

  it("drops a package that finishes after the trying ended, so the track's sound stays", async () => {
    const { sent, preview } = tried();
    preview.open("instrument:" + other, instrumentSound(other, "Tried"));
    preview.close();
    await settle();
    expect(sent).toEqual([{ type: "preview", package: null }]);
  });
});
