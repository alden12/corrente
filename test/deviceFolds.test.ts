import { describe, expect, it } from "vitest";
import { startsOpen } from "../src/ui/devices/deviceFolds";
import { effectSchema } from "../src/audio/effects/catalog";
import { instrumentSchema } from "../src/audio/instruments/catalog";
import { midiDeviceSchema } from "../src/audio/midi/device/catalog";

/** A device starts open only when it has sections to fold to (DAW-61.3). */

describe("whether a device starts open", () => {
  it("opens one with titled sections, which start folded", () => {
    expect(startsOpen("Micro VA", instrumentSchema("micro-va"))).toBe(true);
  });

  it("folds one whose only section is named for itself, or untitled", () => {
    // Reverb's `reverb.` section repeats its name, and its mix has none.
    expect(startsOpen("Reverb", effectSchema("reverb"))).toBe(false);
    expect(startsOpen("Octavator", midiDeviceSchema("octavator"))).toBe(false);
  });
});
