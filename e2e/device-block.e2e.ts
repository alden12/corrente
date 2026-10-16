import { test, expect, type Page } from "@playwright/test";
import { dismissStart, openExploreCategory } from "./support/app";

/**
 * Devices in the rack fold (DAW-61.3): a folded device is its header and a count of its params, and
 * a device's sections fold on their own. Folding is how you're looking, so it outlives a reload.
 */

test.use({ viewport: { width: 1500, height: 1000 } });

const block = (page: Page, name: string) => page.locator(`[role="group"][aria-label="${name}"][data-open]`);

test("a device and its sections fold, and stay folded after a reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openExploreCategory(page, "Effects");
  await page.getByRole("button", { name: "Reverb", exact: true }).click();
  await page
    .getByRole("region", { name: "Reverb" })
    .getByRole("button", { name: /^Add to / })
    .click();

  const reverb = block(page, "Reverb");
  await expect(reverb.getByText("Decay", { exact: true })).toBeVisible();
  await reverb.getByRole("button", { name: "Fold Reverb" }).click();
  await expect(reverb.getByText("Decay", { exact: true })).toHaveCount(0);
  await expect(reverb.getByText("2 params")).toBeVisible(); // folded, it says what it holds

  const instrument = block(page, "Subtractive");
  await instrument.getByRole("button", { name: "Filter Env" }).click();
  await expect(instrument.getByRole("group", { name: "Filter Env" }).getByText("Attack")).toHaveCount(0);
  await expect(instrument.getByRole("group", { name: "Envelope" }).getByText("Attack")).toBeVisible();

  await page.waitForTimeout(600); // past the project's 300ms save tick, so the reverb is saved
  await page.reload();
  await dismissStart(page);
  await expect(block(page, "Reverb")).toHaveAttribute("data-open", "false");
  await expect(block(page, "Subtractive").getByRole("button", { name: "Filter Env" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await block(page, "Reverb").getByRole("button", { name: "Unfold Reverb" }).click();
  await expect(block(page, "Reverb").getByText("Decay", { exact: true })).toBeVisible();
});
