import { describe, expect, it } from "vitest";
import { CatalogueError, NATIVE_BLOCKS, buildCatalogue, creditsFile, type FaustJson } from "../engine/catalogue.ts";

/**
 * The rules compile.ts builds the block catalogue by (INST-36.2), on small hand-written Faust
 * descriptions, so they run without the toolchain. engineBlocks.test.ts checks the real catalogue
 * against the real engine.
 */
const block = (name: string, meta: Record<string, string>, shape: Partial<FaustJson> = {}): FaustJson => ({
  name,
  version: "2.88.0",
  inputs: 1,
  outputs: 1,
  meta: Object.entries(meta).map(([key, value]) => ({ [key]: value })),
  ui: [],
  ...shape,
});

const filter = block(
  "filter",
  {
    description: "A filter.",
    input_ports: "signal -1 1",
    output_ports: "signal -2 2",
    "maths.lib/author": "GRAME",
    "maths.lib/license": "LicenseRef-LGPL-2.1-or-later-with-Faust-exception",
    "vaeffects.lib/moogLadder:author": "Dario Sanfilippo",
    "vaeffects.lib/moogLadder:license": "LicenseRef-STK-4.3",
  },
  {
    ui: [
      {
        type: "vgroup",
        label: "filter",
        items: [
          { type: "hslider", label: "cutoff", meta: [{ "0": "" }, { unit: "Hz" }], init: 4000, min: 20, max: 20000 },
          { type: "vbargraph", label: "level", min: 0, max: 2 },
        ],
      },
    ],
  },
);

const problemsOf = (jsons: FaustJson[]) => {
  try {
    buildCatalogue(jsons);
    return [];
  } catch (error) {
    if (error instanceof CatalogueError) return error.problems;
    throw error;
  }
};

describe("building the catalogue", () => {
  it("reads a block's ports, controls, meters and credits", () => {
    const [built] = buildCatalogue([filter]).blocks;
    expect(built).toEqual({
      name: "filter",
      kind: 0,
      description: "A filter.",
      inputs: [{ name: "signal", min: -1, max: 1 }],
      outputs: [{ name: "signal", min: -2, max: 2 }],
      controls: [{ name: "cutoff", min: 20, max: 20000, unit: "Hz", init: 4000 }],
      meters: [{ name: "level", min: 0, max: 2 }],
      credits: [
        { source: "maths.lib", author: "GRAME", licence: "LicenseRef-LGPL-2.1-or-later-with-Faust-exception" },
        { source: "vaeffects.lib/moogLadder", author: "Dario Sanfilippo", licence: "LicenseRef-STK-4.3" },
      ],
      licences: ["LicenseRef-LGPL-2.1-or-later-with-Faust-exception", "LicenseRef-STK-4.3"],
    });
  });

  it("numbers blocks by name, as the engine does, then adds the native ones", () => {
    const named = (name: string) => block(name, { description: "x", input_ports: "a 0 1", output_ports: "b 0 1" });
    const catalogue = buildCatalogue([named("saw"), named("add"), named("mul")]);
    expect(catalogue.blocks.map((built) => [built.name, built.kind])).toEqual([
      ["add", 0],
      ["mul", 1],
      ["saw", 2],
      ...NATIVE_BLOCKS.map((native) => [native.name, native.kind]),
    ]);
    expect(catalogue.faust).toBe("2.88.0");
  });

  it("reads units and blocks with no inputs", () => {
    const noise = block("noise", { description: "Noise.", input_ports: "", output_ports: "noise -1 1" }, { inputs: 0 });
    const period = block(
      "period",
      {
        description: "A period.",
        input_ports: "frequency 0 24000 Hz, offset 0 100 samples",
        output_ports: "period 0 96000 samples",
      },
      { inputs: 2 },
    );
    const [builtNoise, builtPeriod] = buildCatalogue([noise, period]).blocks;
    expect(builtNoise.inputs).toEqual([]);
    expect(builtPeriod.inputs).toEqual([
      { name: "frequency", min: 0, max: 24000, unit: "Hz" },
      { name: "offset", min: 0, max: 100, unit: "samples" },
    ]);
  });

  it("refuses a licence that isn't on the list, in either spelling", () => {
    const gpl = block("verb", {
      ...Object.fromEntries(filter.meta.flatMap(Object.entries)),
      "reverbs.lib/vital_rev:licence": "GPL-3.0-only",
    });
    expect(problemsOf([gpl])).toEqual([
      "verb: its library code is under GPL-3.0-only, which isn't allowed (catalogue.ts: ALLOWED_LICENCES)",
    ]);
  });

  it("reports every block's missing or wrong declarations together", () => {
    const bare = block("bare", {});
    const miscounted = block("miscounted", { description: "x", input_ports: "a 0 1, b 0 1", output_ports: "c 1 0" });
    expect(problemsOf([bare, miscounted])).toEqual([
      "bare: it declares no description",
      "bare: it declares no input_ports",
      "bare: it declares no output_ports",
      'miscounted: output_ports: "c 1 0" is not "name min max [unit]"',
      "miscounted: it declares 2 input ports but has 1 inputs",
    ]);
  });
});

describe("the credits file", () => {
  it("credits each block's library code and lists the licences used", () => {
    const credits = creditsFile(buildCatalogue([filter]), "THE LICENCE TEXTS");
    expect(credits).toContain("### filter");
    expect(credits).toContain("- `vaeffects.lib/moogLadder`, by Dario Sanfilippo, under LicenseRef-STK-4.3");
    expect(credits).toContain("- LicenseRef-STK-4.3: STK 4.3 (MIT-style): free to use, with this credit");
    expect(credits).toContain("THE LICENCE TEXTS");
  });
});
