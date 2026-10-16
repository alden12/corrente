import { describe, expect, it } from "vitest";
import { DEVICE_COLOR_NAMES, DEVICE_COLORS, deviceColor, deviceHue } from "../src/audio/deviceColors";
import { parseCustomDevice } from "../src/audio/definitions/custom";
import { exploreItems } from "../src/ui/explore/exploreItems";

const effect = {
  type: "ce-colour",
  schema: [{ id: "gain", label: "Gain", kind: "number", min: 0, max: 2, default: 1 }],
  definition: {
    format: 1,
    nodes: {
      left: { block: "mul", inputs: { a: "input.left", b: { param: "gain" } } },
      right: { block: "mul", inputs: { a: "input.right", b: { param: "gain" } } },
    },
    output: ["left", "right"],
  },
};

describe("device colours (DAW-61.2)", () => {
  it("keeps the palette's hues apart, so neighbouring devices contrast", () => {
    const hues = Object.values(DEVICE_COLORS).sort((a, b) => a - b);
    const gaps = hues.map((hue, index) => (hues[(index + 1) % hues.length] - hue + 360) % 360);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(20);
  });

  it("uses the colour a device names", () => {
    expect(deviceColor({ type: "anything", color: "blue" })).toBe("blue");
  });

  it("picks one from the palette for a device that names none, the same one every time", () => {
    const picked = deviceColor({ type: "ci-my-synth" });
    expect(DEVICE_COLOR_NAMES).toContain(picked);
    expect(deviceColor({ type: "ci-my-synth" })).toBe(picked);
  });

  it("lets a custom device name a palette colour, and refuses any other", () => {
    expect(parseCustomDevice({ ...effect, color: "green" }, "effect")).toMatchObject({
      ok: true,
      device: { color: "green" },
    });
    expect(parseCustomDevice({ ...effect, color: "#ff0000" }, "effect")).toMatchObject({ ok: false });
  });

  it("colours a device's Explore card, and a patch's, by the device; a sample by its category", () => {
    const items = exploreItems({ savedPatches: [], samples: [{ id: "kick", name: "Kick 01" }] });
    const item = (name: string) => items.find((each) => each.name === name);
    expect(item("Nimbus")?.hue).toBe(deviceHue({ type: "nimbus", color: "amber" }));
    expect(item("Tape Echo")?.hue).toBe(DEVICE_COLORS.blue);
    const patch = items.find((each) => each.source.kind === "patch" && each.source.patch.instrumentType === "nimbus");
    expect(patch?.hue).toBe(DEVICE_COLORS.amber);
    expect(item("Kick 01")?.hue).toBeUndefined();
  });
});
