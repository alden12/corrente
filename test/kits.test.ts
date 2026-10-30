/** The built-in kits (INST-9.1): each synthesized sample has the voice it is rendered from, and each kit but the default is a patch. */
import { describe, expect, it } from "vitest";
import { BUILTIN_KITS, DEFAULT_KIT, builtinRef } from "../src/audio/samples/catalog";
import { VOICES_808 } from "../src/audio/samples/kits/voices808";
import { FACTORY_PATCHES } from "../src/audio/patches/factory";

const kit808 = BUILTIN_KITS.find((kit) => kit.id === "808")!;

describe("the built-in kits", () => {
  it("renders the 808's samples from its voices, one each", () => {
    expect(VOICES_808.map((voice) => voice.id).sort()).toEqual(kit808.samples.map((sample) => sample.id).sort());
  });

  it("starts a Drum Kit on the house kit", () => {
    expect(DEFAULT_KIT.id).toBe("house");
  });

  it("offers every other kit as a Drum Kit patch, its samples on pads in order on their General MIDI notes", () => {
    const patch = FACTORY_PATCHES.find((candidate) => candidate.name === "808 Kit");
    expect(patch?.instrumentType).toBe("drumkit");
    kit808.samples.forEach((sample, index) => {
      expect(patch?.params[`pad${index + 1}.sample`]).toBe(builtinRef(sample.id));
      expect(patch?.params[`pad${index + 1}.note`]).toBe(sample.gmNote);
    });
    expect(FACTORY_PATCHES.some((candidate) => candidate.name === `${DEFAULT_KIT.name} Kit`)).toBe(false);
  });

  it("puts each kit's sounds on different notes, so no pad hides another", () => {
    for (const kit of BUILTIN_KITS) {
      const notes = kit.samples.map((sample) => sample.gmNote);
      expect(new Set(notes).size).toBe(notes.length);
    }
  });
});
