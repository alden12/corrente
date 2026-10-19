import { afterAll, describe, expect, it } from "vitest";
import { checkEffect, checkInstrument } from "../src/audio/render/deviceCheck";
import { nodeRenderSetup } from "../server/render/nodeRender";
import { ENGINE_INSTRUMENTS } from "../src/audio/instruments/engine";
import { ENGINE_EFFECTS } from "../src/audio/effects/engine";
import { registerEffect, unregisterEffect } from "../src/audio/effects/catalog";
import { registerEngineDevice, unregisterEngineDevice } from "../src/audio/definitions/engineDevices";
import type { ParamSchema } from "../src/audio/params/types";
import type { AuthoredDefinition } from "../src/audio/definitions/format";

/** Built-ins with a known fault the check rightly reports, each with the item that fixes it. */
const KNOWN_FAULTS: Record<string, string> = { "tape-echo": "INST-48" };

describe("checkInstrument / checkEffect (AGENT-4.8)", () => {
  it.each(ENGINE_INSTRUMENTS.map((instrument) => [instrument.type] as const))("%s passes", async (type) => {
    const verdict = await checkInstrument({ type }, nodeRenderSetup());
    expect(verdict.problems).toEqual([]);
    expect(verdict.summary).toMatch(/^OK \(a note peaks at/);
  });

  it.each(ENGINE_EFFECTS.filter((effect) => !KNOWN_FAULTS[effect.type]).map((effect) => [effect.type] as const))(
    "%s passes",
    async (type) => {
      expect((await checkEffect({ type }, nodeRenderSetup())).problems).toEqual([]);
    },
  );

  it("calls a device with its level at zero silent", async () => {
    const verdict = await checkInstrument({ type: "subtractive", params: { "amp.level": 0 } }, nodeRenderSetup());
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain("PROBLEM: silent");
  });

  describe("an effect whose feedback grows", () => {
    const type = "test-runaway-echo";
    const schema: ParamSchema = [];
    // A delay feeding itself back louder than it went in: each repeat grows.
    const definition: AuthoredDefinition = {
      format: 1,
      nodes: {
        delay: {
          block: "delay",
          stereo: true,
          inputs: { signal: ["input", "feedback"], length: 4800, size: 48000 },
        },
        feedback: { block: "mul", stereo: true, inputs: { a: "delay", b: 1.2 } },
      },
      output: ["delay_left", "delay_right"],
    };
    registerEffect({ type, label: "Runaway", schema, custom: true });
    registerEngineDevice(type, { schema, definition });
    afterAll(() => {
      unregisterEffect(type);
      unregisterEngineDevice(type);
    });

    it("is a runaway or never stops, and the summary says so", async () => {
      const verdict = await checkEffect({ type }, nodeRenderSetup());
      expect(verdict.ok).toBe(false);
      expect(verdict.summary).toMatch(/PROBLEM: (runaway|it keeps sounding)/);
    });
  });
});
