import { describe, expect, it } from "vitest";
import { EngineBank } from "../src/audio/bank/bank";
import { BLOCK } from "../src/audio/bank/exports";
import { composeChain, chainParam, type ChainLink } from "../src/audio/definitions/chain";
import { compileDefinition } from "../src/audio/definitions/compile";
import type { DeviceDefinition } from "../src/audio/definitions/format";
import type { ParamSchema } from "../src/audio/params/types";
import { compensate } from "../src/audio/engine/latency";
import { RATE, wasm } from "./support/engine";

/**
 * Latency compensation (INST-36.7): a late device's chain keeps its dry and wet in line, and the
 * mixer delays everything beside a late track so the project stays in time.
 */

describe("compensate", () => {
  it("delays each bus's children to arrive as late as the latest", () => {
    const { delays, total } = compensate(
      [
        { id: "kick", parentId: "drums", latency: 0 },
        { id: "snare", parentId: "drums", latency: 64 },
        { id: "bass", parentId: null, latency: 10 },
      ],
      [{ id: "drums", parentId: null, latency: 100 }],
    );
    // In the drums, the kick waits for the snare; the drums arrive 164 late, so the bass waits 154.
    expect(Object.fromEntries(delays)).toEqual({ kick: 64, snare: 0, drums: 0, bass: 154 });
    expect(total).toBe(164);
  });

  it("delays nothing when nothing is late", () => {
    const { delays, total } = compensate(
      [
        { id: "a", parentId: null, latency: 0 },
        { id: "b", parentId: "g", latency: 0 },
      ],
      [{ id: "g", parentId: null, latency: 0 }],
    );
    expect([...delays.values()].every((delay) => delay === 0)).toBe(true);
    expect(total).toBe(0);
  });
});

describe("a late effect in a chain", () => {
  const LATE = 100;
  /** An effect that plays its input LATE samples late, and says so. */
  const late: DeviceDefinition = {
    format: 1,
    latency: LATE,
    nodes: {
      left: { block: "delay", inputs: { signal: "input.left", length: LATE, size: LATE } },
      right: { block: "delay", inputs: { signal: "input.right", length: LATE, size: LATE } },
    },
    output: ["left", "right"],
  };
  const schema: ParamSchema = [{ id: "mix", label: "Mix", kind: "number", min: 0, max: 1, default: 0.5 }];
  const link: ChainLink = { key: "late", definition: late, schema, effect: true };

  it("delays its dry path as much as its wet, so at half mix a click comes out once, whole", () => {
    const composed = composeChain([link]);
    const plan = compileDefinition(composed.definition, { params: composed.schema });
    expect(plan.latency).toBe(LATE);
    const bank = new EngineBank(wasm, RATE, 1);
    bank.load(0, plan, { [chainParam("late", "mix")]: 0.5 });
    const sound = Array.from({ length: 4 }, (_, block) => {
      bank.input(0, 0).fill(0);
      if (block === 0) bank.input(0, 0)[0] = 1;
      bank.process((block * BLOCK) / RATE);
      return Array.from(bank.output(0, 0));
    }).flat();
    const heard = sound.flatMap((sample, index) => (Math.abs(sample) > 1e-6 ? [[index, sample]] : []));
    expect(heard).toEqual([[LATE, 1]]);
  });
});
