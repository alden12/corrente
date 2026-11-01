import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { dismissStart, openProjectTracks } from "./support/app";

/**
 * The mix as a WAV (DAW-13): the project page's Export menu renders the loop region in the render
 * worker and downloads it, 24-bit stereo at 48 kHz.
 */

test.use({ viewport: { width: 1320, height: 900 } });

test("exports the loop region's mix as a 24-bit stereo WAV", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    (async () => {
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page.getByRole("menuitem", { name: "Mix of the loop region (WAV)" }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toBe("project-1-mix.wav");

  const bytes = await readFile((await download.path())!);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  expect(text(0)).toBe("RIFF");
  expect(text(8)).toBe("WAVE");
  expect(view.getUint16(22, true)).toBe(2); // channels
  expect(view.getUint32(24, true)).toBe(48000); // rate
  expect(view.getUint16(34, true)).toBe(24); // bits
  // The loop region's length: 16 beats at 120 BPM, eight seconds, with no tail.
  expect(view.getUint32(40, true)).toBe(8 * 48000 * 2 * 3);
});
