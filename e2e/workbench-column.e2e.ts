import { test, expect, type Page } from "@playwright/test";
import { dismissStart, openExploreCategory } from "./support/app";

/**
 * The workbench is one scrolling column (DAW-61.1): the clips line, the roll, then the devices.
 * Once the roll has scrolled away a slim bar brings it back, or jumps to any device.
 */

test.use({ viewport: { width: 1320, height: 800 } });

async function addEffect(page: Page, name: string) {
  await openExploreCategory(page, "Effects");
  await page.getByRole("button", { name, exact: true }).first().click();
  await page
    .getByRole("region", { name })
    .getByRole("button", { name: /^Add to / })
    .click();
}

test("the roll scrolls away to the devices, and the return bar brings it back", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  for (const name of ["Reverb", "Tape Echo", "Chorus"]) await addEffect(page, name);

  const returnToRoll = page.getByRole("button", { name: /^Roll/ });
  await expect(returnToRoll).toHaveCount(0); // the roll is on screen

  // Jumping to the last device scrolls the roll off the top, and the bar takes its place.
  await page.locator('[data-device][aria-label="Chorus"]').scrollIntoViewIfNeeded();
  await expect(returnToRoll).toBeVisible();
  await expect(returnToRoll).toContainText("Clip 1"); // it names the clip open in the roll

  // A device's chip scrolls to it.
  await page.getByRole("button", { name: "Subtractive", exact: true }).click();
  await expect(page.locator('[data-device][aria-label="Subtractive"]')).toBeInViewport();

  await returnToRoll.click();
  await expect(page.getByTestId("roll-scroll")).toBeInViewport();
  await expect(returnToRoll).toHaveCount(0);
});

test("the clips line opens into every clip, and folds back to one line", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const toggle = page.getByRole("button", { name: "Open the clips" });
  await toggle.click();
  await expect(page.getByRole("button", { name: "Fold the clips" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Fold the clips" }).click();
  await expect(page.getByRole("button", { name: "Open the clips" })).toHaveAttribute("aria-expanded", "false");
});
