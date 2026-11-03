/**
 * The factory sample sets the import makes (INST-55): where each comes from, pinned to a commit, and
 * how it is curated down from the library as recorded to what a browser can hold. Each sound becomes
 * a sample map, `factory:<set>/<sound>`.
 */
import type { SfzRegion } from "./sfz";

/** A region the curation keeps, with the velocities it now answers (widened over the layers dropped). */
export interface Kept {
  region: SfzRegion;
  lovel: number;
  hivel: number;
}

export interface FactorySound {
  id: string;
  name: string;
  /** The regions to keep, from the instrument's own. */
  keep: (regions: SfzRegion[]) => Kept[];
}

export interface FactorySetSource {
  id: string;
  name: string;
  licence: string;
  /** The credit a CC-BY licence asks for, as the credits file prints it. */
  credit: string;
  /** A GitHub repository, the commit its files are read at, and its SFZ instrument file. */
  repo: string;
  commit: string;
  entry: string;
  /** Longest a recording is kept, in seconds, faded out over the last `fadeSeconds`. */
  capSeconds: number;
  fadeSeconds: number;
  sounds: FactorySound[];
}

const number = (region: SfzRegion, opcode: string) => Number(region.opcodes[opcode]);

/** Salamander's note regions: natural tuning, struck (not its release, hammer or pedal noises). */
const salamanderNotes = (regions: SfzRegion[]) =>
  regions.filter(
    (region) =>
      region.opcodes.sw_last === "C0" &&
      region.opcodes.trigger !== "release" &&
      !Object.keys(region.opcodes).some((opcode) => opcode.startsWith("locc")),
  );

/**
 * One layer for each of `ranges`: the layer whose velocities hold the range's middle, answering the
 * whole range. The lowest starts at 0, not SFZ's usual 1, so the softest touch still sounds.
 */
const layersFor =
  (ranges: [number, number][]) =>
  (regions: SfzRegion[]): Kept[] =>
    ranges.flatMap(([lovel, hivel]) => {
      const middle = (lovel + hivel) / 2;
      return salamanderNotes(regions)
        .filter((region) => number(region, "lovel") <= middle && middle <= number(region, "hivel"))
        .map((region) => ({ region, lovel, hivel }));
    });

export const FACTORY_SETS: FactorySetSource[] = [
  {
    id: "salamander",
    name: "Salamander Grand Piano",
    licence: "CC-BY-3.0",
    credit: "Salamander Grand Piano by Alexander Holm (Yamaha C5), SFZ by kinwie, CC BY 3.0",
    repo: "sfzinstruments/SalamanderGrandPiano",
    commit: "3382bf9496bba2486f5ab0de55a264d1dfc38404",
    entry: "Salamander Grand Piano V3.sfz",
    capSeconds: 6,
    fadeSeconds: 0.5,
    sounds: [
      {
        id: "grand",
        name: "Grand Piano",
        keep: layersFor([
          [0, 42],
          [43, 85],
          [86, 127],
        ]),
      },
      { id: "grand-lite", name: "Grand Piano (Lite)", keep: layersFor([[0, 127]]) },
    ],
  },
];
