import { test, expect } from "@playwright/test";
import { dismissStart, openExploreCategory } from "./support/app";

/**
 * Favourites (COMM-1.9.3): heart a device anywhere in Explore and it waits on the Favourites page,
 * newest first, across a reload. The e2e build has no API, so this is the local-only path; the
 * server sync is covered by the unit tests.
 */

test.use({ viewport: { width: 1320, height: 900 } });

test("heart devices, find them in Favourites newest first, and un-heart one", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await openExploreCategory(page, "Favourites");
  await expect(page.getByText("Tap the heart on any device")).toBeVisible();

  await openExploreCategory(page, "Instruments");
  await page.getByRole("button", { name: 'Add "FM" to favourites' }).click();
  await expect(page.getByRole("button", { name: 'Remove "FM" from favourites' })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await openExploreCategory(page, "Effects");
  await page.getByRole("button", { name: 'Add "Reverb" to favourites' }).click();

  // A project's samples live in that project only, so they cannot be hearted.
  await openExploreCategory(page, "Samples");
  await expect(page.getByRole("button", { name: /to favourites$/ })).toHaveCount(0);

  await openExploreCategory(page, "Favourites");
  const rows = page.getByTestId("explore-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Reverb");
  await expect(rows.nth(1)).toContainText("FM");

  // Kept across a reload, and un-hearting takes it off the page at once.
  await page.reload();
  await dismissStart(page);
  await openExploreCategory(page, "Favourites");
  await expect(rows).toHaveCount(2);
  await page.getByRole("button", { name: 'Remove "Reverb" from favourites' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText("FM");
});

test("the panel an item opens carries its heart too, in step with its row (DAW-58)", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await openExploreCategory(page, "Instruments");
  await page.getByRole("button", { name: "FM", exact: true }).click();
  const panel = page.getByRole("region", { name: "Trying FM" });
  await panel.getByRole("button", { name: 'Add "FM" to favourites' }).click();
  // The row's heart is the same favourite, so it turns on with the panel's.
  await expect(page.getByRole("button", { name: 'Remove "FM" from favourites' })).toHaveCount(2);

  await openExploreCategory(page, "Effects");
  await page.getByRole("button", { name: "Reverb", exact: true }).click();
  await page
    .getByRole("region", { name: "Reverb" })
    .getByRole("button", { name: 'Add "Reverb" to favourites' })
    .click();
  await openExploreCategory(page, "Favourites");
  await expect(page.getByTestId("explore-row")).toHaveCount(2);
});
