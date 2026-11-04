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
  /**
   * Answer every key, played at its own pitch: a drum's sound, which a kit's pad picks by its own note,
   * so a pad moved to another note still sounds. Otherwise each region keeps the keys the SFZ gives it.
   */
  anyKey?: boolean;
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
  /**
   * A library recorded with several mics, each its own folder of the same hits (`oh/snare/oh_snare_…`,
   * `kickmic/snare/kickmic_snare_…`): the curation picks from the first's regions, and each hit is
   * mixed down to stereo with its counterparts in the rest, as the library's own program layers them.
   */
  mics?: string[];
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

/**
 * A drum's hits from a multi-mic library's lead mic (`/oh_<piece>_vl`): `layers` of its velocity layers,
 * spread from softest to hardest, widened to answer every velocity between them, and up to
 * `roundRobins` takes of each, which the map plays in turn.
 */
const drumHits =
  (piece: string, layers: number, roundRobins: number) =>
  (regions: SfzRegion[]): Kept[] => {
    const hits = regions.filter((region) => region.sample.includes(`_${piece}_vl`));
    // SFZ's default top is 127, which the hardest layer often leaves unsaid.
    const layerOf = (region: SfzRegion) => Number(region.opcodes.hivel ?? 127);
    const recorded = [...new Set(hits.map(layerOf))].sort((low, high) => low - high);
    // Evenly through what was recorded, always the softest and the hardest.
    const chosen = Array.from(
      { length: Math.min(layers, recorded.length) },
      (_, index) =>
        recorded[layers === 1 ? recorded.length - 1 : Math.round((index * (recorded.length - 1)) / (layers - 1))],
    );
    return chosen.flatMap((hivel, index) => {
      const lovel = index === 0 ? 0 : chosen[index - 1] + 1;
      const top = index === chosen.length - 1 ? 127 : hivel;
      return hits
        .filter((region) => layerOf(region) === hivel && Number(region.opcodes.seq_position ?? 1) <= roundRobins)
        .map((region) => ({ region, lovel, hivel: top }));
    });
  };

/** A drum: its id and name, and its hits as `drumHits` keeps them, on whatever key its pad gives it. */
const drum = (id: string, name: string, piece: string, layers: number, roundRobins: number): FactorySound => ({
  id,
  name,
  keep: drumHits(piece, layers, roundRobins),
  anyKey: true,
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
  {
    id: "virtuosity",
    name: "Virtuosity Drums",
    licence: "CC0-1.0",
    credit: "Virtuosity Drums by Versilian Studios, CC0",
    repo: "sfzinstruments/virtuosity_drums",
    commit: "9f04cf9a734527edfbb0a4eee1f674e45bbf71bc",
    entry: "Programs/01-basic-kit.sfz",
    // The basic program's mics: the overheads, and the kick and snare close mics mixed in.
    mics: ["oh", "kickmic", "snaremic"],
    capSeconds: 4,
    fadeSeconds: 1,
    sounds: [
      drum("kick", "Kick", "kick_snon", 4, 2),
      drum("snare", "Snare", "snare_center", 4, 2),
      drum("rimshot", "Rimshot", "snare_rimshot", 3, 2),
      drum("side-stick", "Side Stick", "snare_stickshot1", 3, 1),
      drum("low-tom", "Low Tom", "ltom_center", 3, 2),
      drum("high-tom", "High Tom", "htom_center", 3, 2),
      drum("hat-closed", "Closed Hat", "hh_closed", 3, 2),
      drum("hat-pedal", "Pedal Hat", "hh_pedal", 2, 2),
      drum("hat-open", "Open Hat", "hh_open", 3, 2),
      drum("crash", "Crash", "crash_crash", 2, 2),
      drum("ride", "Ride", "ride_ride", 3, 2),
      drum("ride-bell", "Ride Bell", "ride_bell", 2, 2),
    ],
  },
];
