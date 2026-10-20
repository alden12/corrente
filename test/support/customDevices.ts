/**
 * A valid custom instrument and effect for tests (INST-36.8): the smallest devices that compile and
 * play, a saw through an envelope and a gain. Named by the test, so two tests (or two projects in
 * one) can each have their own.
 */
import type { CustomDevice } from "../../src/audio/definitions/custom";

export const customInstrument = (type = "ci-test0001", label = "Test Synth"): CustomDevice => ({
  type,
  label,
  schema: [{ id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 }],
  definition: {
    format: 1,
    nodes: {
      osc: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
      envelope: { block: "adsr", voice: true, inputs: { gate: "voice.gate" } },
      amp: { block: "mul", voice: true, inputs: { a: "osc", b: "envelope" } },
      left: { block: "mul", inputs: { a: "voices.left", b: { param: "level" } } },
      right: { block: "mul", inputs: { a: "voices.right", b: { param: "level" } } },
    },
    voice: "amp",
    output: ["left", "right"],
  },
});

export const customEffect = (type = "ce-test0001", label?: string): CustomDevice => ({
  type,
  ...(label ? { label } : {}),
  schema: [{ id: "gain", label: "Gain", kind: "number", min: 0, max: 2, default: 1 }],
  definition: {
    format: 1,
    nodes: {
      left: { block: "mul", inputs: { a: "input.left", b: { param: "gain" } } },
      right: { block: "mul", inputs: { a: "input.right", b: { param: "gain" } } },
    },
    output: ["left", "right"],
  },
});

/** What create_instrument / create_effect take: a device without its type, which the server mints. */
export const authored = ({ type: _type, ...device }: CustomDevice) => device;
