import { describe, it, expect } from "vitest";
import {
  parseCustomDevice,
  parseCustomDevices,
  DEVICE_FORMAT_VERSION,
  type CustomDevice,
} from "../src/audio/definitions/custom";
import { engineDevice } from "../src/audio/definitions/engineDevices";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { hasInstrument, instrumentSchema } from "../src/audio/instruments/catalog";

const validInstrument: CustomDevice = {
  type: "ci-test",
  label: "Test Synth",
  schema: [
    { id: "level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8 },
    { id: "cutoff", label: "Cutoff", kind: "number", min: 20, max: 20000, default: 2000 },
  ],
  definition: {
    format: 1,
    nodes: {
      osc: { block: "saw", voice: true, inputs: { frequency: "voice.frequency" } },
      envelope: { block: "adsr", voice: true, inputs: { gate: "voice.gate" } },
      filter: { block: "onepole", voice: true, inputs: { signal: "osc", cutoff: { param: "cutoff" } } },
      amp: { block: "mul", voice: true, inputs: { a: "filter", b: "envelope" } },
      level_l: { block: "mul", inputs: { a: "voices.left", b: { param: "level" } } },
      level_r: { block: "mul", inputs: { a: "voices.right", b: { param: "level" } } },
    },
    voice: "amp",
    output: ["level_l", "level_r"],
  },
};

const validEffect: CustomDevice = {
  type: "ce-test",
  schema: [{ id: "gain", label: "Gain", kind: "number", min: 0, max: 2, default: 1 }],
  definition: {
    format: 1,
    nodes: {
      left: { block: "mul", inputs: { a: "input.left", b: { param: "gain" } } },
      right: { block: "mul", inputs: { a: "input.right", b: { param: "gain" } } },
    },
    output: ["left", "right"],
  },
};

/** One that a newer build might read: a block this one doesn't have. */
const newer = {
  ...validInstrument,
  type: "ci-newer",
  definition: { format: 1, nodes: { x: { block: "reverbtron", voice: true } }, voice: "x" },
};

describe("parseCustomDevice (untrusted-input gate)", () => {
  it("keeps an instrument and an effect that compile", () => {
    expect(parseCustomDevice(validInstrument, "instrument")).toEqual({ ok: true, device: validInstrument });
    expect(parseCustomDevice(validEffect, "effect")).toEqual({ ok: true, device: validEffect });
  });

  it("refuses one that won't compile, naming every problem", () => {
    const bad = {
      ...validInstrument,
      definition: {
        ...validInstrument.definition,
        nodes: {
          ...validInstrument.definition.nodes,
          filter: { block: "onepole", voice: true, inputs: { signal: "ghost", cutoff: { param: "nope" } } },
        },
      },
    };
    const result = parseCustomDevice(bad, "instrument");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses an instrument with no voices, and an effect with them", () => {
    expect(parseCustomDevice({ ...validEffect, type: "ci-x" }, "instrument")).toMatchObject({ ok: false });
    expect(parseCustomDevice({ ...validInstrument, type: "ce-x" }, "effect")).toMatchObject({ ok: false });
  });

  it("refuses a device in the old graph format", () => {
    const old = {
      type: "ci-old",
      schema: [],
      voice: { nodes: [{ id: "osc", kind: "osc" }], connections: [["osc", "amp"]] },
    };
    expect(parseCustomDevice(old, "instrument")).toMatchObject({ ok: false });
  });
});

describe("parseCustomDevices (a project's)", () => {
  it("keeps the ones that compile, and hands back the rest exactly as they were", () => {
    const result = parseCustomDevices({
      customInstruments: [validInstrument, newer],
      customEffects: [validEffect],
      deviceFormatVersion: DEVICE_FORMAT_VERSION,
    });
    expect(result.instruments.map((device) => device.type)).toEqual(["ci-test"]);
    expect(result.effects.map((device) => device.type)).toEqual(["ce-test"]);
    expect(result.unreadable.instruments).toEqual([newer]);
  });

  it("plays none from another format version (the old graph format is 1), handing them all back", () => {
    const result = parseCustomDevices({ customInstruments: [validInstrument], deviceFormatVersion: 1 });
    expect(result.instruments).toHaveLength(0);
    expect(result.unreadable.instruments).toEqual([validInstrument]);
  });
});

describe("custom devices through ProjectStore", () => {
  it("registers a custom instrument schema and round-trips it through snapshot/load", () => {
    const store = new ProjectStore();
    store.addCustomInstrument(validInstrument);
    // Its schema is registered, so a track could build a param store from it.
    expect(hasInstrument("ci-test")).toBe(true);
    expect(instrumentSchema("ci-test").some((spec) => spec.id === "cutoff")).toBe(true);
    // And its definition, so the engine plays it.
    expect(engineDevice("ci-test")?.definition).toEqual(validInstrument.definition);

    const snap = store.snapshot();
    expect(snap.customInstruments?.map((def) => def.type)).toContain("ci-test");
    expect(snap.deviceFormatVersion).toBe(DEVICE_FORMAT_VERSION);

    // A fresh store loading the snapshot re-registers the device.
    const reloaded = new ProjectStore();
    reloaded.load(snap);
    expect(reloaded.customInstruments.map((def) => def.type)).toContain("ci-test");
    expect(hasInstrument("ci-test")).toBe(true);

    reloaded.removeCustomInstrument("ci-test");
    expect(hasInstrument("ci-test")).toBe(false);
    expect(engineDevice("ci-test")).toBeUndefined();
  });

  it("keeps a device it cannot read through a load and a save, for the build that can", () => {
    const store = new ProjectStore();
    store.load({ ...new ProjectStore().snapshot(), customInstruments: [validInstrument, newer as CustomDevice] });
    // Not playable here: only the readable one is registered.
    expect(store.customInstruments.map((def) => def.type)).toEqual(["ci-test"]);
    expect(hasInstrument("ci-newer")).toBe(false);
    // But saving does not delete it.
    expect(store.snapshot().customInstruments).toEqual([validInstrument, newer]);
  });

  it("sets aside an invalid embedded device on load rather than throwing", () => {
    const store = new ProjectStore();
    const bad = {
      customInstruments: [{ type: "ci-bad", schema: [], definition: { format: 1, nodes: {} } }],
    };
    expect(() => store.load(bad as never)).not.toThrow();
    expect(store.customInstruments).toHaveLength(0);
  });

  it("undo removes a just-added custom instrument; redo restores it", () => {
    const store = new ProjectStore();
    const log = new EditLog(store);
    log.dispatch({ type: "addCustomInstrument", def: validInstrument }, "agent:you");
    expect(store.customInstruments.map((def) => def.type)).toContain("ci-test");
    log.undo();
    expect(store.customInstruments.some((def) => def.type === "ci-test")).toBe(false);
    log.redo();
    expect(store.customInstruments.map((def) => def.type)).toContain("ci-test");
    store.removeCustomInstrument("ci-test"); // cleanup (registry is module-global)
  });
});
