import { describe, expect, it } from "vitest";
import { parseSfz } from "../scripts/factory/sfz";

/** Files from memory, by path. */
const files = (byPath: Record<string, string>) => (path: string) => {
  const text = byPath[path];
  if (text === undefined) throw new Error(`no file ${path}`);
  return text;
};

describe("reading an SFZ instrument (INST-55)", () => {
  it("merges each region with the headers above it, the nearest winning", () => {
    const regions = parseSfz(
      "piano.sfz",
      files({
        "piano.sfz": `
          <control> default_path=Samples/
          <global> volume=-3 off_time=0.5
          <group> lovel=1 hivel=64 volume=-1
          <region> sample=C4 soft.flac lokey=59 hikey=61 pitch_keycenter=60
          <group> lovel=65 hivel=127
          <region> sample=C4 loud.flac lokey=59 hikey=61 pitch_keycenter=60 // a comment
        `,
      }),
    );
    expect(regions.map((region) => region.sample)).toEqual(["Samples/C4 soft.flac", "Samples/C4 loud.flac"]);
    expect(regions[0].opcodes).toMatchObject({ volume: "-1", off_time: "0.5", lovel: "1", pitch_keycenter: "60" });
    // The second group started afresh: the first one's volume is gone, the global's is back.
    expect(regions[1].opcodes).toMatchObject({ volume: "-3", lovel: "65" });
  });

  it("applies defines from where they stand, so a file included twice reads each value", () => {
    const regions = parseSfz(
      "main.sfz",
      files({
        "main.sfz": `<group> #include "vel1.txt" lovel=1 hivel=63 #include "notes.txt"
<group> #include "vel2.txt" lovel=64 hivel=127 #include "notes.txt"`,
        "vel1.txt": "#define $VEL v1",
        "vel2.txt": "#define $VEL v2",
        "notes.txt": "<region> lokey=21 hikey=22 pitch_keycenter=21 sample=A0$VEL.flac",
      }),
    );
    expect(regions.map((region) => [region.sample, region.opcodes.lovel])).toEqual([
      ["A0v1.flac", "1"],
      ["A0v2.flac", "64"],
    ]);
  });

  it("leaves out the headers that hold no regions", () => {
    const regions = parseSfz("kit.sfz", files({ "kit.sfz": "<curve> v000=0 v127=1\n<region> sample=kick.wav key=36" }));
    expect(regions).toEqual([{ opcodes: { sample: "kick.wav", key: "36" }, sample: "kick.wav" }]);
  });
});
