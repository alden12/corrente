/**
 * Editing a custom device (update_instrument / update_effect) reaches the live engine: the track
 * playing it is rebuilt with the new definition, while a reload that leaves the definition as it
 * was (undo of something else) keeps the instrument it had, so held notes are not cut.
 */
import { test, expect } from "@playwright/test";

test("an edited custom instrument is rebuilt on its track; an unchanged reload keeps it", async ({ page }) => {
  await page.goto("/");
  // A click first: the engine's AudioContext needs a user gesture to run.
  await page.mouse.click(5, 5);
  const result = await page.evaluate(async () => {
    const { AudioEngine } = await import(/* @vite-ignore */ "/src/audio/engine/AudioEngine.ts");
    const { ProjectStore } = await import(/* @vite-ignore */ "/src/audio/project/projectStore.ts");
    const project = new ProjectStore(false);
    const voiceOf = (block: string) => ({
      format: 1,
      nodes: {
        osc: { block, voice: true, inputs: { frequency: "voice.frequency" } },
        envelope: { block: "adsr", voice: true, inputs: { gate: "voice.gate" } },
        amp: { block: "mul", voice: true, inputs: { a: "osc", b: "envelope" } },
      },
      voice: "amp",
    });
    const def = {
      type: "ci-e2e-edit",
      label: "Edit Me",
      schema: [{ id: "level", label: "Level", kind: "number" as const, min: 0, max: 1, default: 0.8 }],
      definition: voiceOf("saw"),
    };
    project.addCustomInstrument(def);
    const track = project.addTrack(def.type);
    const engine = new AudioEngine();
    await engine.start(project);
    const before = engine.getInstrument(track.id);

    project.load(project.snapshot()); // re-parses every def, but none changed
    const afterReload = engine.getInstrument(track.id);

    project.addCustomInstrument({ ...def, definition: voiceOf("triangle") });
    const afterEdit = engine.getInstrument(track.id);
    engine.dispose();
    return {
      built: before !== undefined,
      keptOnReload: afterReload === before,
      rebuiltOnEdit: afterEdit !== undefined && afterEdit !== before,
    };
  });
  expect(result).toEqual({ built: true, keptOnReload: true, rebuiltOnEdit: true });
});
