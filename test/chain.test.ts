import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EngineBank } from "../src/audio/bank/bank";
import { BLOCK } from "../src/audio/bank/exports";
import { chainPlan, leadingRun, piecesOf } from "../src/audio/bank/chainPlan";
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
