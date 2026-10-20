import { describe, expect, it } from "vitest";
import { renderClient, type ClientPort } from "../src/audio/render/worker/renderClient";
import { serveRenders } from "../src/audio/render/worker/serveRenders";
import type { FromWorker, ToWorker } from "../src/audio/render/worker/messages";
import { exploreItems } from "../src/ui/explore/exploreItems";
import { engineCopy } from "../server/render/nodeRender";
import { ProjectStore } from "../src/audio/project/projectStore";
import type { Patch } from "../src/audio/patches/patch";
import { customEffect, customInstrument } from "./support/customDevices";

/** The render worker in this process: both ends of its channel, a message apart, as a real one is. */
const inProcess = () =>
  renderClient((): ClientPort => {
    let toPage: (message: FromWorker) => void = () => undefined;
    let toWorker: (message: ToWorker) => void = () => undefined;
    serveRenders({
      post: (message) => queueMicrotask(() => toPage(message)),
      listen: (handler) => (toWorker = handler),
    });
    return {
      post: (message) => queueMicrotask(() => toWorker(message)),
      listen: (handler) => (toPage = handler),
      onFail: () => undefined,
      terminate: () => undefined,
    };
  });

const noSamples = { sample: async () => null };

describe("portraits of what the user made (COMM-1.9.6)", () => {
  it("draws a custom instrument on the render worker, carrying its definition", async () => {
    const synth = customInstrument("ci-portrait1", "Portrait Synth");
    const portrait = await inProcess().portrait({
      job: { kind: "instrument", type: synth.type, devices: { instruments: [synth] } },
      engine: engineCopy(),
      load: noSamples,
    });
    expect((portrait.line ?? portrait.fill ?? "").length).toBeGreaterThan(20);
  });

  it("draws a custom effect and a patch through it", async () => {
    const gain = customEffect("ce-portrait1");
    const worker = inProcess();
    const effect = await worker.portrait({
      job: { kind: "effect", type: gain.type, devices: { effects: [gain] } },
      engine: engineCopy(),
      load: noSamples,
    });
    const patch = await worker.portrait({
      job: {
        kind: "patch",
        sound: { instrumentType: "subtractive", params: {}, effects: [{ type: gain.type, params: {} }] },
        devices: { effects: [gain] },
      },
      engine: engineCopy(),
      load: noSamples,
    });
    expect((effect.line ?? effect.fill ?? "").length).toBeGreaterThan(20);
    expect((patch.line ?? patch.fill ?? "").length).toBeGreaterThan(20);
  });

  it("says why a portrait can't be drawn, rather than hanging", async () => {
    await expect(
      inProcess().portrait({ job: { kind: "instrument", type: "ci-nowhere" }, engine: engineCopy(), load: noSamples }),
    ).rejects.toThrow();
  });

  it("gives Explore a drawing for custom devices and saved patches, and none for built-ins", () => {
    const synth = customInstrument("ci-portrait2", "Drawn Synth");
    const gain = customEffect("ce-portrait2");
    const saved: Patch = {
      id: "pt-portrait",
      name: "Mine",
      author: "you",
      instrumentType: "subtractive",
      params: { cutoff: 900 },
      effects: [],
      createdAt: 1,
    };
    // Explore lists the custom devices the catalogs have, as a loaded project registers them.
    const project = new ProjectStore(false);
    project.addCustomInstrument(synth);
    project.addCustomEffect(gain);
    const items = exploreItems({ savedPatches: [saved], samples: [], project });
    const drawingOf = (key: string) => items.find((item) => item.key === key)?.drawing;
    expect(drawingOf(`instrument:${synth.type}`)).toEqual({
      kind: "instrument",
      type: synth.type,
      devices: { instruments: [synth] },
    });
    expect(drawingOf(`effect:${gain.type}`)).toEqual({ kind: "effect", type: gain.type, devices: { effects: [gain] } });
    expect(drawingOf("patch:pt-portrait")).toEqual({
      kind: "patch",
      sound: { instrumentType: "subtractive", params: { cutoff: 900 }, effects: [] },
    });
    expect(items.filter((item) => item.builtin && item.drawing)).toEqual([]);
  });
});
