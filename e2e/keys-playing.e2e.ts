import { test, expect } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * The keys light with what the selected track is playing (MOBILE-13), not only what you press: a clip
 * playing back lights its notes' keys while they sound, more quietly than a press, and a note no shown
 * key holds marks the edge of the key beside it, or of its column's key above or below.
 */

test.use({ viewport: { width: 1280, height: 1100 } });

test("a clip playing back lights its notes' keys, and they go out when it stops", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // A note in the seed track's clip, from the roll.
  const box = (await page.getByTestId("roll-scroll").boundingBox())!;
  await page.mouse.dblclick(box.x + 60, box.y + 40);
  await expect(page.getByTestId("note")).toHaveCount(1);

  const playing = page.locator("button[data-pitches][data-playing]");
  // A note no shown key holds marks the edge of a key instead.
  const edged = () =>
    page
      .locator("button[data-pitches]")
      .evaluateAll((keys) => keys.filter((key) => (key as HTMLElement).style.boxShadow.includes("color-mix")).length);
  await expect(playing).toHaveCount(0);

  await page.getByRole("button", { name: /Play/ }).click();
  // On a shown key it lights; off them, the edge says so.
  await expect
    .poll(async () => (await playing.count()) + (await edged()), { message: "the note shows" })
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: /Stop/ }).click();
  await expect(playing).toHaveCount(0);
  await expect.poll(edged).toBe(0);
});

test("a played key lights as a press, not as the track playing it", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await expect(page.getByRole("button", { name: /Play/ })).toBeEnabled();
  await page.keyboard.down("z");
  const pressed = page.locator('button[data-pitches][aria-pressed="true"]');
  await expect(pressed).toHaveCount(1);
  // The engine reports the note too, but the press is what the pad shows.
  await page.waitForTimeout(200);
  await expect(pressed).not.toHaveAttribute("data-playing");
  await page.keyboard.up("z");
});
