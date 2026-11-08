import { test, expect } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Mixer header controls: an adjoined Mute/Solo button group on tracks and groups,
 * and a low-profile fader. Here we exercise the mute/solo toggles on a track.
 */

test.use({ viewport: { width: 1320, height: 900 } });

test("mute and solo toggle on a track", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const scroll = page.getByTestId("arr-scroll");

  // Solo the track, then un-solo it.
  await scroll.getByTitle("Solo", { exact: true }).first().click();
  await expect(scroll.getByTitle("Unsolo").first()).toBeVisible();
  await scroll.getByTitle("Unsolo").first().click();

  // Mute the track.
  await scroll.getByTitle("Mute", { exact: true }).first().click();
  await expect(scroll.getByTitle("Unmute").first()).toBeVisible();

  // The fader is present as a slider.
  await expect(scroll.getByRole("slider", { name: "Volume" }).first()).toBeVisible();
});

test("a track's volume knob meters its level on its ring, and reads out in decibels (DAW-8.5)", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const scroll = page.getByTestId("arr-scroll");
  const knob = scroll.getByRole("slider", { name: "Volume", exact: true }).first();
  await expect(knob).toHaveAttribute("aria-valuetext", /dB$/);

  // The ring is empty in silence, and fills as a note sounds.
  const level = async () => Number(await knob.getAttribute("data-level"));
  await expect.poll(level).toBe(0);
  await page.keyboard.down("z");
  await expect.poll(level, { message: "the ring fills with the note" }).toBeGreaterThan(0.1);
  await page.keyboard.up("z");

  // A double-click puts it back to 0 dB.
  await knob.focus();
  await page.keyboard.press("ArrowDown");
  await expect(knob).not.toHaveAttribute("aria-valuetext", "0.0 dB");
  await knob.dblclick();
  await expect(knob).toHaveAttribute("aria-valuetext", "0.0 dB");
});

test("the master strip: a fader in decibels, undoable, and a stereo meter (DAW-8.5)", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const master = page.getByRole("slider", { name: "Master volume" });
  await expect(master).toHaveAttribute("aria-valuetext", "0.0 dB");
  await master.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(master).not.toHaveAttribute("aria-valuetext", "0.0 dB");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(master).toHaveAttribute("aria-valuetext", "0.0 dB");

  // Both sides' bars open as a note sounds, and the peak reads out in decibels.
  const bars = page.getByTestId("master-meter-bar");
  const opened = () =>
    bars.evaluateAll(
      (elements) => elements.filter((element) => !/inset\(0px 100%/.test(getComputedStyle(element).clipPath)).length,
    );
  await master.blur();
  await page.keyboard.down("z");
  await expect.poll(opened, { message: "both sides of the master meter rise" }).toBe(2);
  await expect(page.getByTestId("master-peak")).toHaveText(/^-\d+\.\d$/);
  await page.keyboard.up("z");
});
