import { test, expect, type Page } from "@playwright/test";
import { dismissStart, openRowAction, openProjectList } from "./support/app";

/**
 * Portable .daw.zip export/import (from the Projects page): export, on a project's row,
 * downloads the whole project as a zip; import, under New, makes a new project from one
 * and opens it. We export the seed, add a placement so the live state differs, then
 * import the exported file and confirm the new project is what was exported.
 */

test.use({ viewport: { width: 1320, height: 900 } });

const placements = (page: Page) => page.getByTestId("placement");

async function zoomOut(page: Page) {
  const btn = page.getByTitle("Zoom out", { exact: true });
  for (let i = 0; i < 3; i++) await btn.click();
}

test("export then import a .daw file restores the project", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await zoomOut(page);

  await expect(placements(page)).toHaveCount(1); // the seed placement

  // Export the seed project (one placement) from its row on the Projects page.
  await openProjectList(page);
  const [download] = await Promise.all([page.waitForEvent("download"), openRowAction(page, "Export…")]);
  expect(download.suggestedFilename()).toBe("untitled.daw.zip");
  const file = await download.path();

  // Change the live project: drag the empty lane to create + place a 2nd clip.
  const seed = (await placements(page).first().boundingBox())!;
  const y = seed.y + seed.height / 2;
  await page.mouse.move(seed.x + seed.width + 40, y);
  await page.mouse.down();
  await page.mouse.move(seed.x + seed.width + 160, y, { steps: 8 });
  await page.mouse.up();
  await expect(placements(page)).toHaveCount(2);

  // Import the earlier export: a second project opens, holding the one-placement state, and the
  // edited one is still there beside it.
  await page.getByLabel("Import project file").setInputFiles(file);
  await expect(page.getByRole("list", { name: "Projects" }).getByRole("listitem")).toHaveCount(2);
  await expect(placements(page)).toHaveCount(1);
});
