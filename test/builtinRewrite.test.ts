import { describe, expect, it } from "vitest";
import { EngineBank } from "../src/audio/bank/bank";
import { BLOCK } from "../src/audio/bank/exports";
import type { AuthoredDefinition } from "../src/audio/definitions/format";
import { composeChain } from "../src/audio/definitions/chain";
import { compileDefinition } from "../src/audio/definitions/compile";
import { engineDevice } from "../src/audio/definitions/engineDevices";
import { effectFromGraph, instrumentFromGraph } from "../src/audio/definitions/fromGraph";
import { plainDefinition } from "../src/audio/definitions/stereo";
import { engineValueOf } from "../src/audio/definitions/values";
import { buildBanks } from "../src/audio/dsp/wavetable";
import { BUILTIN_GRAPH_EFFECTS, BUILTIN_GRAPH_INSTRUMENTS } from "../src/audio/graph/builtins";
import type { ParamSchema } from "../src/audio/params/types";
import { tableOf } from "../src/audio/samples/tables";
import { RATE, wasm } from "./support/engine";

/**
 * The graph built-ins rewritten in the engine's format (INST-36.8 part 6): each was generated from
 * its conversion and tidied (stereo nodes, no scales of 1), so each must play exactly what its
 * conversion played. Goes with the converter.
 */

const SECONDS = 1.5;
const NOTES = [36, 38, 42, 57, 64];

/** A decaying stereo tone, for any sample param that isn't a wavetable. */
const tone = () => {
  const samples = Float32Array.from(
    { length: RATE },
    (_, index) => Math.sin((2 * Math.PI * 220 * index) / RATE) * Math.exp(-index / (RATE * 0.3)),
  );
  return { channels: [samples, samples.map((value) => value * 0.5)], rate: RATE };
};
const classic = () => ({ channels: [tableOf(buildBanks()[0])], rate: RATE });

/** The largest of many numbers (too many to spread into Math.max). */
const largest = (values: number[]) => values.reduce((most, value) => Math.max(most, value), 0);

const render = (definition: AuthoredDefinition, schema: ParamSchema, effect: boolean) => {
  const composed = composeChain([{ key: "device", definition: plainDefinition(definition), schema, effect }]);
  const bank = new EngineBank(wasm, RATE, 1);
  const values = Object.fromEntries(
    composed.schema.flatMap((spec) => (spec.kind === "sample" ? [] : [[spec.id, engineValueOf(spec, spec.default)]])),
  );
  bank.load(0, compileDefinition(composed.definition, { params: composed.schema }), values);
  composed.schema.forEach(
    (spec) => spec.kind === "sample" && bank.setSample(0, spec.id, spec.id, spec.wavetable ? classic() : tone()),
  );
  if (!effect)
    NOTES.forEach((note, index) => {
      bank.noteOn(0, note, 0.8, index * 0.05);
      bank.noteOff(0, note, 0.6 + index * 0.05);
    });
  const blocks = Math.ceil((SECONDS * RATE) / BLOCK);
  return Array.from({ length: blocks }, (_, block) => {
    if (effect)
      [0, 1].forEach((channel) =>
        bank.input(0, channel).forEach((_, index, input) => {
          const sample = block * BLOCK + index;
          input[index] = sample < RATE / 2 ? Math.sin((2 * Math.PI * (220 + channel * 110) * sample) / RATE) : 0;
        }),
      );
    bank.process((block * BLOCK) / RATE);
    return [0, 1].flatMap((channel) => Array.from(bank.output(0, channel)));
  }).flat();
};

describe("the built-ins rewritten in the engine's format", () => {
  const cases = [
    ...BUILTIN_GRAPH_INSTRUMENTS.map((def) => ({ type: def.type, effect: false, converted: instrumentFromGraph(def) })),
    ...BUILTIN_GRAPH_EFFECTS.map((def) => ({ type: def.type, effect: true, converted: effectFromGraph(def) })),
  ];
  it.each(cases)("$type plays what its conversion played", ({ type, effect, converted }) => {
    const rewritten = engineDevice(type)!;
    expect(rewritten.schema).toEqual(converted.schema);
    const before = render(converted.definition, converted.schema, effect);
    const after = render(rewritten.definition, rewritten.schema, effect);
    expect(largest(before.map(Math.abs))).toBeGreaterThan(0.01);
    expect(largest(after.map((sample, index) => Math.abs(sample - before[index])))).toBeLessThan(1e-6);
  });
});
