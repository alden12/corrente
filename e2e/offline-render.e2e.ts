import { test, expect } from "@playwright/test";

/**
 * The real path: renderProjectOffline consumes a ProjectStore (a seeded synth track + a wavetable
 * worklet track, each with a note), builds the instrument -> effects -> group -> master graph, and
 * schedules the flattened arrangement. Non-silent proves the project-consuming render works end to
 * end in a real browser.
 */
test("a project (synth + worklet tracks) renders to a non-silent buffer offline", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => typeof (window as unknown as { __dawRenderProjectSmoke?: unknown }).__dawRenderProjectSmoke === "function",
  );

  const peak = await page.evaluate(async () =>
    (window as unknown as { __dawRenderProjectSmoke: () => Promise<number> }).__dawRenderProjectSmoke(),
  );

  expect(peak).toBeGreaterThan(0.001);
});

/**
 * Sampler pre-decode: a sampler's buffer decodes asynchronously and, without Instrument.ready,
 * would render silent offline (the render runs to completion before the decode lands). A sampler
 * track (default sample: builtin:kick) with a note must render non-silent - proving the render
 * awaits sample readiness before startRendering.
 */
test("a sampler track renders to a non-silent buffer offline (sample pre-decode)", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => typeof (window as unknown as { __dawRenderSamplerSmoke?: unknown }).__dawRenderSamplerSmoke === "function",
  );

  const peak = await page.evaluate(async () =>
    (window as unknown as { __dawRenderSamplerSmoke: () => Promise<number> }).__dawRenderSamplerSmoke(),
  );

  expect(peak).toBeGreaterThan(0.001);
});

/**
 * Audio tracks: a recorded take (a synthetic sine stored via putAudio) on an audio track must be
 * decoded and scheduled into the render, so the offline mix includes recorded audio, not just
 * instrument tracks. Non-silent proves the audio-clip decode + windowed scheduling path.
 */
test("an audio track (recorded take) renders to a non-silent buffer offline", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __dawRenderAudioTrackSmoke?: unknown }).__dawRenderAudioTrackSmoke === "function",
  );

  const peak = await page.evaluate(async () =>
    (window as unknown as { __dawRenderAudioTrackSmoke: () => Promise<number> }).__dawRenderAudioTrackSmoke(),
  );

  expect(peak).toBeGreaterThan(0.001);
});

/**
 * MIDI devices: a track with an octavator device must route its notes through the device chain
 * (via an offline transport clock) into the instrument, not play them raw or drop them. Non-silent
 * proves the device pipeline renders offline (arps/octavators self-schedule from the clock).
 */
test("an instrument track with a MIDI device renders to a non-silent buffer offline", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __dawRenderMidiDeviceSmoke?: unknown }).__dawRenderMidiDeviceSmoke === "function",
  );

  const peak = await page.evaluate(async () =>
    (window as unknown as { __dawRenderMidiDeviceSmoke: () => Promise<number> }).__dawRenderMidiDeviceSmoke(),
  );

  expect(peak).toBeGreaterThan(0.001);
});

/**
 * The full "agent ears" chain end to end: render offline -> analyzeMix -> summarizeMix, the exact
 * logic behind the analyze_mix agent tool. Proves the render produces measurable audio and the
 * analysis yields a sane, model-friendly report (audible, with headroom, not clipping: a single note
 * sits well under full scale).
 */
test("render + analyze produces a sane mix report (analyze_mix chain)", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => typeof (window as unknown as { __dawAnalyzeMix?: unknown }).__dawAnalyzeMix === "function",
  );

  const report = (await page.evaluate(async () =>
    (window as unknown as { __dawAnalyzeMix: () => Promise<Record<string, unknown>> }).__dawAnalyzeMix(),
  )) as { peakDbfs: number; headroomDb: number; loudnessDbfs: number; clipping: boolean; note: string };

  expect(report.clipping).toBe(false);
  expect(report.peakDbfs).toBeGreaterThan(-120); // audible, not silent
  expect(report.peakDbfs).toBeLessThanOrEqual(0.5); // under (or at) full scale
  expect(report.headroomDb).toBeGreaterThan(0);
  expect(typeof report.note).toBe("string");
});

/**
 * The engine render core (AGENT-4.9) against the browser's own offline render of the same project, a
 * piece of the mix at a time. The core is what the agent hears in Node, so it has to sound like the
 * app: the same level and the same shape across the octave bands.
 */
for (const name of ["synth", "bass", "track effect", "group effect", "audio clip"])
  test(`the engine render core sounds like the browser's offline render: ${name}`, async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => typeof (window as unknown as { __dawRenderBothWays?: unknown }).__dawRenderBothWays === "function",
    );
    type Levels = { bands: number[]; rms: number };
    const { offline, core } = await page.evaluate(
      async (project) =>
        (
          window as unknown as { __dawRenderBothWays: (name: string) => Promise<{ offline: Levels; core: Levels }> }
        ).__dawRenderBothWays(project),
      name,
    );
    expect(Math.abs(offline.rms - core.rms)).toBeLessThan(0.5);
    // Every band audible in either, at the same level.
    core.bands.forEach((db, index) => {
      if (Math.max(db, offline.bands[index]) < -90) return;
      expect(Math.abs(offline.bands[index] - db)).toBeLessThan(1);
    });
  });
