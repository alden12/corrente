import { test, expect } from "@playwright/test";

/**
 * The full "agent ears" chain end to end: render in the worker -> analyzeRender -> summarizeMix, the
 * exact logic behind the analyze_mix agent tool. Proves the render produces measurable audio and the
 * analysis yields a sane, model-friendly report (audible, with headroom, not clipping: a chord and a
 * bass sit well under full scale).
 */
test("render + analyze produces a sane mix report (analyze_mix chain)", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => typeof (window as unknown as { __dawAnalyzeMix?: unknown }).__dawAnalyzeMix === "function",
  );

  const report = (await page.evaluate(async () =>
    (window as unknown as { __dawAnalyzeMix: () => Promise<Record<string, unknown>> }).__dawAnalyzeMix(),
  )) as {
    peakDbfs: number;
    headroomDb: number;
    loudnessDbfs: number;
    clipping: boolean;
    note: string;
    bands: Record<string, number>;
  };

  expect(report.clipping).toBe(false);
  expect(report.peakDbfs).toBeGreaterThan(-120); // audible, not silent
  expect(report.peakDbfs).toBeLessThanOrEqual(0.5); // under (or at) full scale
  expect(report.headroomDb).toBeGreaterThan(0);
  expect(typeof report.note).toBe("string");
  expect(Object.keys(report.bands)).toHaveLength(9);
});

/**
 * The render worker (AGENT-4.9 part 3b) against the engine render core run on the page, for projects
 * that each need something carried across to it: several notes and tracks, a sample, effects on a
 * track and a group, a MIDI device, an audio clip. The worker has to hear exactly what the core does.
 */
for (const name of ["chord and bass", "sampler", "track and group effects", "MIDI device", "audio clip"])
  test(`a project renders the same in the worker as on the page: ${name}`, async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(
      () => typeof (window as unknown as { __dawRenderBothPlaces?: unknown }).__dawRenderBothPlaces === "function",
    );
    const compared = await page.evaluate(
      async (project) =>
        (
          window as unknown as {
            __dawRenderBothPlaces: (name: string) => Promise<{ peak: number; difference: number; omitted: string[] }>;
          }
        ).__dawRenderBothPlaces(project),
      name,
    );
    expect(compared.peak).toBeGreaterThan(0.01);
    expect(compared.difference).toBe(0);
    expect(compared.omitted).toEqual([]);
  });
