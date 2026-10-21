import { test, expect } from "@playwright/test";
import { dismissStart, openExploreCategory, openProjectList } from "./support/app";

/**
 * Back up the library and restore it somewhere with none of it (HOST-23.2.1.2): a fresh browser
 * context is a new device, with its own storage. A favourite stands in for the library here; patches
 * and custom devices are covered by the unit tests.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function openBackup(page: import("@playwright/test").Page) {
  await openProjectList(page);
  const note = page.getByRole("region", { name: "Saved in browser" });
  await note.getByRole("button", { name: "Saved in browser" }).click();
  return note;
}

test("a library backup brings favourites back on a new device", async ({ page, browser }) => {
  await page.goto("/");
  await dismissStart(page);
  await openExploreCategory(page, "Instruments");
  await page.getByRole("button", { name: 'Add "FM" to favourites' }).click();

  const note = await openBackup(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    note.getByRole("button", { name: "Back up library" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^corrente-library-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();

  const elsewhere = await (await browser.newContext({ viewport: { width: 1320, height: 900 } })).newPage();
  await elsewhere.goto("/");
  await dismissStart(elsewhere);
  await openBackup(elsewhere);
  await elsewhere.getByLabel("Restore library file").setInputFiles(file);
  await expect(elsewhere.getByRole("status")).toHaveText("Library restored: added 1 favourite.");

  await elsewhere.getByRole("button", { name: "Explore", exact: true }).click();
  await openExploreCategory(elsewhere, "Favourites");
  await expect(elsewhere.getByTestId("explore-row")).toHaveCount(1);
  await expect(elsewhere.getByTestId("explore-row").first()).toContainText("FM");
});
