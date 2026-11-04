import { describe, expect, it } from "vitest";
import { padCount, playsPads } from "../src/audio/instruments/pads";
import { instrumentSchema, pickableInstrumentInfos } from "../src/audio/instruments/catalog";
import { DRUMKIT_PADS } from "../src/audio/instruments/engine/drumkit";
import type { ParamSchema } from "../src/audio/params/types";

const pad = (number: number): ParamSchema => [
  { id: `pad${number}.sample`, label: "Sample", kind: "sample", default: "" },
  { id: `pad${number}.note`, label: "Note", kind: "number", min: 0, max: 127, default: 36 },
];

describe("pad instruments (INST-54)", () => {
  it("reads a kit from its schema, not its name: the three kits, nothing else built in", () => {
    expect(padCount(instrumentSchema("drumkit"))).toBe(DRUMKIT_PADS);
    expect(
      pickableInstrumentInfos()
        .filter((info) => playsPads(info.schema))
        .map((info) => info.type),
    ).toEqual(["acoustic-kit", "drumkit", "808-kit"]);
  });

  it("counts a pad only with both a sample and a note", () => {
    expect(padCount([...pad(1), ...pad(2)])).toBe(2);
    expect(padCount([pad(1)[0]])).toBe(0);
    expect(playsPads(instrumentSchema("sampler"))).toBe(false);
  });
});
