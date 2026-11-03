import { describe, expect, it } from "vitest";
import { factoryMap, toShorts } from "../src/audio/samples/factoryMap";
import {
  FACTORY_SETS,
  FACTORY_SOUNDS,
  factorySound,
  soundSize,
  usesFactorySamples,
} from "../src/audio/samples/factory";
import { parseRef, refLabel } from "../src/audio/samples/catalog";
import type { ShortAudio } from "../src/audio/bank/bank";

const audio: ShortAudio = { shorts: [new Int16Array(4)], rate: 48000 };

describe("factory samples (INST-55)", () => {
  it("names each sound by a factory ref the catalog reads", () => {
    expect(parseRef("factory:salamander/grand")).toEqual({ kind: "factory", id: "salamander/grand" });
    expect(refLabel("factory:salamander/grand")).toBe("Grand Piano");
    expect(FACTORY_SOUNDS.map((sound) => sound.ref)).toContain("factory:salamander/grand-lite");
    expect(usesFactorySamples({ "sampler.sample": "factory:salamander/grand" })).toBe(true);
    expect(usesFactorySamples({ "sampler.sample": "builtin:kick" })).toBe(false);
  });

  it("covers every velocity on every key it plays, with no gaps", () => {
    for (const set of FACTORY_SETS) {
      for (const sound of set.sounds) {
        const keys = [...new Set(sound.regions.flatMap((region) => [region.lokey, region.hikey]))];
        const low = Math.min(...keys);
        const high = Math.max(...keys);
        for (let key = low; key <= high; key++) {
          for (let velocity = 0; velocity <= 127; velocity++) {
            const fits = sound.regions.some(
              (region) =>
                region.lokey <= key && key <= region.hikey && region.lovel <= velocity && velocity <= region.hivel,
            );
            expect(fits, `${set.id}/${sound.id} at key ${key}, velocity ${velocity}`).toBe(true);
          }
        }
      }
    }
  });

  it("loads each recording once, telling how far it has got", async () => {
    const sound = factorySound("salamander/grand")!;
    const asked: string[] = [];
    const progress: number[] = [];
    const map = await factoryMap(
      "salamander/grand",
      async (region) => {
        asked.push(region.file);
        return audio;
      },
      (loaded) => progress.push(loaded),
    );
    expect(map?.regions.length).toBe(sound.regions.length);
    expect(new Set(asked).size).toBe(asked.length);
    expect(progress.at(-1)).toBe(soundSize(sound).download);
    expect(map?.regions[0]).toMatchObject({ ref: `factory-file:${sound.regions[0].file}`, audio });
  });

  it("gives no map when a recording doesn't load, rather than a piano missing notes", async () => {
    let calls = 0;
    expect(await factoryMap("salamander/grand", async () => (++calls === 3 ? null : audio))).toBeNull();
    expect(await factoryMap("salamander/nothing", async () => audio)).toBeNull();
  });

  it("makes decoded floats 16-bit, holding anything past full scale", () => {
    expect(Array.from(toShorts([Float32Array.from([0, 0.5, -1, 2])])[0])).toEqual([0, 16384, -32768, 32767]);
  });
});
