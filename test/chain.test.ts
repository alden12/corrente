import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EngineBank } from "../src/audio/bank/bank";
import { BLOCK } from "../src/audio/bank/exports";
import { carryWords } from "../src/audio/bank/carry";
import { chainEdit, chainPlan, leadingRun, ownerOf, piecesOf } from "../src/audio/bank/chainPlan";
import { TEST_EFFECTS, TEST_INSTRUMENTS, registerTestInstruments } from "../src/audio/bank/testInstruments";
import { instrumentChain } from "../src/audio/engine/trackInstrument";
import { ParamStore } from "../src/audio/params/store";
import { BYPASS, chainParam, composeChain, type ChainLink } from "../src/audio/definitions/chain";
import { compileDefinition } from "../src/audio/definitions/compile";

/**
 * A chain as one plan (INST-36.7): an instrument and the effects after it composed into one
 * definition, each effect's input the device before it, its mix and bypass params of the chain.
 */
const RATE = 48000;
const wasm = readFileSync(fileURLToPath(new URL("../engine/engine.wasm", import.meta.url)));

const device = (type: string) => [...TEST_INSTRUMENTS, ...TEST_EFFECTS].find((candidate) => candidate.type === type)!;
const link = (type: string, key: string, effect = true): ChainLink => ({
  key,
  definition: device(type).definition,
  schema: device(type).schema,
  effect,
});
/** The defaults of every param of a composed chain, by its names in the chain. */
const defaultsOf = (schema: ReturnType<typeof composeChain>["schema"]) =>
  Object.fromEntries(schema.map((spec) => [spec.id, spec.kind === "number" ? spec.default : 0]));

/** A note through a chain, a second of it, left channel; `values` over the defaults. */
const play = (links: ChainLink[], values: Record<string, number> = {}) => {
  const composed = composeChain(links);
  const bank = new EngineBank(wasm, RATE, 1);
  bank.load(0, compileDefinition(composed.definition, { params: composed.schema }), {
    ...defaultsOf(composed.schema),
    ...values,
  });
  bank.noteOn(0, 57, 1, 0);
  bank.noteOff(0, 57, 0.05);
  return Array.from({ length: Math.ceil(RATE / BLOCK) }, (_, block) => {
    bank.process((block * BLOCK) / RATE);
    return Array.from(bank.output(0, 0));
  }).flat();
};

describe("composeChain", () => {
  it("names each device's nodes and params apart, so the same effect twice doesn't collide", () => {
    const composed = composeChain([
      link("engine-pluck", "instrument", false),
      link("engine-echo", "a"),
      link("engine-echo", "b"),
    ]);
    expect(Object.keys(composed.definition.nodes)).toEqual(
      expect.arrayContaining(["xinstrument_string", "xa_left", "xb_left", "xa_out_left", "xb_out_right"]),
    );
    expect(composed.schema.map((spec) => spec.id)).toEqual(
      expect.arrayContaining([chainParam("a", "time"), chainParam("b", "time"), chainParam("a", BYPASS)]),
    );
    expect(composed.params[chainParam("b", "feedback")]).toEqual({ link: 2, param: "feedback" });
    expect(() => compileDefinition(composed.definition, { params: composed.schema })).not.toThrow();
  });

  it("plays the instrument through each effect in turn", () => {
    const short = { [chainParam("instrument", "decay")]: 0.2 };
    const dry = play([link("engine-pluck", "instrument", false)], short);
    const echoed = play([link("engine-pluck", "instrument", false), link("engine-echo", "echo")], {
      ...short,
      [chainParam("echo", "mix")]: 1,
    });
    // A short pluck dies away within half a second; the echo carries it on past that.
    const lateOf = (sound: number[]) => Math.max(...sound.slice(RATE / 2).map(Math.abs));
    expect(lateOf(dry)).toBeLessThan(0.01);
    expect(lateOf(echoed)).toBeGreaterThan(0.01);
  });

  it("passes the dry sound through an effect at no mix, or bypassed", () => {
    const dry = play([link("engine-pluck", "instrument", false)]);
    const chain = [link("engine-pluck", "instrument", false), link("engine-echo", "echo")];
    expect(play(chain, { [chainParam("echo", "mix")]: 0 })).toEqual(dry);
    expect(play(chain, { [chainParam("echo", "mix")]: 1, [chainParam("echo", BYPASS)]: 1 })).toEqual(dry);
  });

  it("runs effects alone on the track's input, the first reading it", () => {
    const composed = composeChain([link("engine-resonator", "ring"), link("engine-echo", "echo")]);
    expect(composed.definition.voices).toBeUndefined();
    // The resonator's delays read the track's input; the echo's read the resonator's mixed output.
    const reads = (name: string) => JSON.stringify(composed.definition.nodes[name].inputs);
    expect(reads("xring_left")).toContain("input.left");
    expect(reads("xecho_left")).toContain("xring_out_left");
    expect(() => compileDefinition(composed.definition, { params: composed.schema })).not.toThrow();
  });

  it("carries an instrument's zones and their sample params", () => {
    const composed = composeChain([link("engine-drums", "instrument", false), link("engine-echo", "echo")]);
    expect(composed.definition.zones?.[0].sample.param).toBe(chainParam("instrument", "kick"));
    const plan = compileDefinition(composed.definition, { params: composed.schema });
    expect(plan.params).toEqual(
      expect.arrayContaining([{ param: chainParam("instrument", "kick"), scale: 1, offset: 0, sample: true }]),
    );
  });
});

describe("chain pieces", () => {
  // Register the test devices as engine devices, as devTools does.
  registerTestInstruments();
  const effect = (id: string, type: string, bypassed = false) => ({ id, type, bypassed, params: new ParamStore([]) });

  it("groups consecutive engine effects into runs, the rest on their own", () => {
    const chain = [
      effect("a", "engine-echo"),
      effect("b", "engine-resonator", true),
      effect("c", "delay"),
      effect("d", "engine-echo"),
    ];
    expect(
      piecesOf(chain).map((piece) => (piece.kind === "run" ? piece.effects.map(({ id }) => id) : piece.effect.id)),
    ).toEqual([["a", "b"], "c", ["d"]]);
    expect(leadingRun(chain).map(({ id }) => id)).toEqual(["a", "b"]);
    expect(leadingRun([effect("c", "delay"), ...chain]).map(({ id }) => id)).toEqual([]);
  });

  it("composes an engine instrument with the run after it, and nothing else", () => {
    const store = new ParamStore(device("engine-pluck").schema);
    const chain = [effect("a", "engine-echo"), effect("b", "delay"), effect("c", "engine-echo")];
    expect(instrumentChain("engine-pluck", store, chain)?.absorbed.map(({ id }) => id)).toEqual(["a"]);
    expect(instrumentChain("subtractive", store, chain)).toBeUndefined();
    expect(chainPlan([{ key: "x", type: "delay", store }], false)).toBeUndefined();
  });
});

describe("keeping state across a reload", () => {
  it("keeps the devices in both chains, and fades out and back in the ones that change order", () => {
    expect(chainEdit(["instrument", "a"], ["instrument", "b", "a"])).toEqual({
      kept: new Set(["instrument", "a"]),
      added: ["b"],
      removed: [],
      moved: [],
    });
    expect(chainEdit(["instrument", "a", "b"], ["instrument", "b"])?.removed).toEqual(["a"]);
    // Kept ones swapped round change their inputs at once, so they fade out and back in.
    expect(chainEdit(["instrument", "a", "b"], ["instrument", "b", "a"])?.moved).toEqual(["instrument", "b", "a"]);
    expect(chainEdit(["a"], ["b"])).toBeUndefined();
  });

  it("finds the device a node is from, when one key's prefix begins another's", () => {
    expect(ownerOf(["a", "a_b"], "xa_b_left")).toBe("a_b");
    expect(ownerOf(["a", "a_b"], "xa_left")).toBe("a");
    expect(ownerOf(["a"], "xc_left")).toBeUndefined();
  });

  const compiled = (links: ChainLink[]) => {
    const composed = composeChain(links);
    return { composed, plan: compileDefinition(composed.definition, { params: composed.schema }) };
  };
  const pluckEcho = [link("engine-pluck", "instrument", false), link("engine-echo", "a")];
  const withResonator = [...pluckEcho, link("engine-resonator", "b")];
  const keepFrom = (keys: string[]) => (name: string) =>
    keys.includes(
      ownerOf(
        withResonator.map((each) => each.key),
        name,
      )!,
    );

  it("carries the kept devices' nodes and the voices, and starts the added ones fresh", () => {
    const before = compiled(pluckEcho).plan;
    const after = compiled(withResonator).plan;
    const words = carryWords(before, after, keepFrom(["instrument", "a"]))!;
    expect(words[0]).toBe(1);
    const post = Array.from(words.slice(3 + words[1]));
    after.nodes.post.forEach((node, index) => {
      const from = post[index];
      if (node.name.startsWith("xb_")) expect(from).toBe(-1);
      else expect(before.nodes.post[from]).toEqual(node);
    });
    // Nothing kept, nothing carried.
    expect(carryWords(before, after, () => false)).toBeUndefined();
  });

  it("plays on through an effect added bypassed exactly as if nothing had changed", () => {
    const before = compiled(pluckEcho);
    const after = compiled(withResonator);
    const values = (composed: ReturnType<typeof composeChain>) => ({
      ...defaultsOf(composed.schema),
      [chainParam("a", "time")]: 0.1,
      [chainParam("b", BYPASS)]: 1,
    });
    /**
     * A note held through a reload at block 20 (carrying, crossfading, or no reload), 40 blocks of it;
     * `fadeIn` adds the resonator unbypassed, ramping in from bypassed.
     */
    const played = (reload: "carry" | "crossfade" | "none", fadeIn = false) => {
      const bank = new EngineBank(wasm, RATE, 1);
      bank.load(0, before.plan, values(before.composed));
      bank.noteOn(0, 57, 1, 0);
      return Array.from({ length: 40 }, (_, block) => {
        if (block === 20 && reload !== "none")
          bank.load(
            0,
            after.plan,
            { ...values(after.composed), ...(fadeIn ? { [chainParam("b", BYPASS)]: 0 } : {}) },
            reload === "carry"
              ? {
                  carry: carryWords(before.plan, after.plan, keepFrom(["instrument", "a"])),
                  ...(fadeIn ? { from: { [chainParam("b", BYPASS)]: 1 } } : {}),
                }
              : {},
          );
        bank.process((block * BLOCK) / RATE);
        return Array.from(bank.output(0, 0));
      }).flat();
    };
    const unchanged = played("none");
    const carried = played("carry");
    expect(Math.max(...carried.map((sample, index) => Math.abs(sample - unchanged[index])))).toBeLessThan(1e-6);
    // Without the carry the note starts again and the echo empties: not the same at all.
    // Added unbypassed, the resonator ramps in over the block from bypassed: at its first sample it is
    // a 128th of the way in, so barely there.
    const fading = played("carry", true);
    const at = 20 * BLOCK;
    expect(Math.abs(fading[at] - unchanged[at])).toBeLessThan(1e-3);
    expect(
      Math.max(...fading.slice(at + BLOCK).map((sample, index) => Math.abs(sample - unchanged[at + BLOCK + index]))),
    ).toBeGreaterThan(0.01);
    const crossfaded = played("crossfade");
    expect(Math.max(...crossfaded.map((sample, index) => Math.abs(sample - unchanged[index])))).toBeGreaterThan(0.01);
  });
});
