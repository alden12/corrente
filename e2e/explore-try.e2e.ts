import { test, expect, type Page } from "@playwright/test";
import { dismissStart, openExploreCategory, setCountIn } from "./support/app";

/**
 * Trying a sound from Explore (COMM-1.4.1): tapping an instrument or patch opens it in the try
 * panel without touching the project; the keys and pads play it; Add or Swap is the edit; and
 * recording while trying puts the take on a new track carrying that sound, in one edit.
 */

const trying = (page: Page, name: string) => page.getByRole("region", { name: `Trying ${name}` });

test.describe("desktop", () => {
  test.use({ viewport: { width: 1320, height: 900 } });

  test("trying a sound leaves the project alone, and Add makes it a new track", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    const trackHeaders = page.getByTitle("Double-click to rename");
    const before = await trackHeaders.count();

    await openExploreCategory(page, "Instruments");
    await page.getByRole("button", { name: "FM", exact: true }).click();
    await expect(trying(page, "FM")).toBeVisible();
    await expect(trying(page, "FM").getByText("LIVE", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "FM", exact: true })).toHaveAttribute("aria-current", "true");
    await expect(trackHeaders).toHaveCount(before);

    await trying(page, "FM").getByRole("button", { name: "Add as a new track" }).click();
    await expect(trackHeaders).toHaveCount(before + 1);
    await expect(page.getByRole("tablist").getByText("fm", { exact: true })).toBeVisible();
    await expect(trying(page, "FM")).toHaveCount(0);
  });

  test("recording while trying puts the take on a new track with that sound", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setCountIn(page, "None");
    const trackHeaders = page.getByTitle("Double-click to rename");
    const before = await trackHeaders.count();

    await openExploreCategory(page, "Instruments");
    await page.getByRole("button", { name: "FM", exact: true }).click();
    await expect(trying(page, "FM")).toBeVisible();

    const record = page.getByRole("button", { name: "Record", exact: true });
    await record.click();
    await expect(record).toHaveAttribute("aria-pressed", "true");
    await expect(trying(page, "FM").getByText("REC", { exact: true })).toBeVisible();
    for (const key of ["z", "x"]) {
      await page.keyboard.down(key);
      await page.waitForTimeout(120);
      await page.keyboard.up(key);
    }
    await record.click();
    await expect(record).toHaveAttribute("aria-pressed", "false");

    // One new track, carrying the sound and the take; trying is over, so the keys play it now.
    await expect(trackHeaders).toHaveCount(before + 1);
    await expect(page.getByRole("tablist").getByText("fm", { exact: true })).toBeVisible();
    await expect(page.getByTestId("lane").getByText("Take 1")).toBeVisible();
    await expect(trying(page, "FM")).toHaveCount(0);

    // ... and it was one edit: a single undo takes the track and the take together.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(trackHeaders).toHaveCount(before);
  });

  test("leaving Explore stops trying", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await openExploreCategory(page, "Instruments");
    await page.getByRole("button", { name: "FM", exact: true }).click();
    await expect(trying(page, "FM")).toBeVisible();

    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await page.getByRole("button", { name: "Explore", exact: true }).click();
    await expect(trying(page, "FM")).toHaveCount(0);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the try panel has pads to play it with, and stays on Explore", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await page.getByRole("navigation", { name: "Places" }).getByRole("button", { name: "Explore", exact: true }).tap();
    await openExploreCategory(page, "Instruments");
    await page.getByRole("button", { name: "FM", exact: true }).tap();

    const panel = trying(page, "FM");
    await expect(panel).toBeVisible();
    await expect(panel.locator("[data-pitches]").first()).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Places" }).getByRole("button", { name: "Explore", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });
});

test.describe("effects", () => {
  test.use({ viewport: { width: 1320, height: 900 } });

  test("tapping an effect shows it with its Add, and only Add puts it on the track", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await openExploreCategory(page, "Effects");
    const named = page.getByText("Reverb", { exact: true });
    const before = await named.count(); // its row

    await page.getByRole("button", { name: "Reverb", exact: true }).click();
    const panel = page.getByRole("region", { name: "Reverb" });
    await expect(panel).toBeVisible();
    await expect(named).toHaveCount(before + 1); // the panel; nothing added to the track yet

    await panel.getByRole("button", { name: /^Add to / }).click();
    await expect(panel).toHaveCount(0);
    await expect(named).toHaveCount(before + 1); // the panel went, and the device rack shows it

    // Trying a sound takes the panel's place, one at a time.
    await page.getByRole("button", { name: "Reverb", exact: true }).click();
    await expect(panel).toBeVisible();
    await openExploreCategory(page, "Instruments");
    await page.getByRole("button", { name: "FM", exact: true }).click();
    await expect(page.getByRole("region", { name: "Trying FM" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Reverb" })).toHaveCount(0);
  });

  test("an effect's + adds it to the selected track in one click, no panel", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await openExploreCategory(page, "Effects");
    const named = page.getByText("Reverb", { exact: true });
    const before = await named.count();

    await page.getByRole("button", { name: 'Add "Reverb" to the selected track' }).click();
    await expect(page.getByRole("region", { name: "Reverb" })).toHaveCount(0);
    await expect(named).toHaveCount(before + 1); // the device rack shows it
  });

  test("a MIDI device shows its panel too, and adds to the selected instrument track", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await openExploreCategory(page, "MIDI devices");
    const first = page.getByTestId("explore-row").first().getByRole("button").first();
    const name = (await first.getAttribute("aria-label"))!;
    await first.click();
    const panel = page.getByRole("region", { name });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: /^Add to / }).click();
    await expect(panel).toHaveCount(0);
  });
});
