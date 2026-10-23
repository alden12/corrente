import { describe, expect, it } from "vitest";
import { bindingOf } from "../src/audio/bank/binding";
import { chainPlan } from "../src/audio/bank/chainPlan";
import { devicePackage, toBase64, type PackageSamples } from "../src/audio/bank/devicePackage";
import { instrumentSchema } from "../src/audio/instruments/catalog";
import { ParamStore } from "../src/audio/params/store";

/**
 * Device packages (PLUGIN-3): one value per binding value, in its order, each a param, a sample with
 * its audio embedded, or a fixed number. The plugin's own tests play exported packages against the
 * app's renders.
 */
const chainOf = (type: string) => {
  const store = new ParamStore(instrumentSchema(type));
  const chain = chainPlan([{ key: "instrument", type, store }], true);
  if (!chain) throw new Error(`${type} isn't an engine instrument`);
  return { chain, store };
};

/** Stand-in sample sources: a file is its ref's bytes, a table two floats. */
const samples: PackageSamples = {
  file: async (ref) => new TextEncoder().encode(ref),
  table: async () => Float32Array.from([0.5, -0.5]),
};

const titled = (id: string) => `title of ${id}`;

describe("devicePackage", () => {
  it("lists every binding value in order, params with their spec, title and engine value", async () => {
    const { chain, store } = chainOf("subtractive");
    const made = await devicePackage(chain, "Subtractive", samples, titled);
    expect(made.values.map((value) => value.name)).toEqual(bindingOf(chain.plan).names);
    expect(made.binding).toEqual(bindingOf(chain.plan).words);
    expect(made.words).toEqual(Array.from(chain.plan.words));
    const param = made.values.find((value) => value.kind === "param");
    if (param?.kind !== "param") throw new Error("a param");
    const source = chain.sources[param.name];
    expect(param.title).toBe(`title of ${source.id}`);
    expect(param.spec).toEqual(store.spec(source.id));
  });

  it("embeds each sample's file, and a wavetable's table, as base64", async () => {
    const drums = await devicePackage(chainOf("drumkit").chain, "Drum Kit", samples, titled);
    const kick = drums.values.find((value) => value.kind === "sample" && value.ref === "builtin:kick");
    expect(kick).toMatchObject({ file: toBase64(new TextEncoder().encode("builtin:kick")) });
    const wavetable = await devicePackage(chainOf("wavetable").chain, "Wavetable", samples, titled);
    const table = wavetable.values.find((value) => value.kind === "sample");
    expect(table).toMatchObject({ table: toBase64(new Uint8Array(Float32Array.from([0.5, -0.5]).buffer)) });
  });

  it("gives a plan param no store holds its fixed value", async () => {
    const { chain } = chainOf("subtractive");
    const [first] = bindingOf(chain.plan).names;
    const bypassed = {
      ...chain,
      sources: Object.fromEntries(Object.entries(chain.sources).filter(([name]) => name !== first)),
    };
    const made = await devicePackage(bypassed, "Subtractive", samples, titled, { [first]: 1 });
    expect(made.values[0]).toEqual({ kind: "fixed", name: first, raw: 1 });
  });
});
