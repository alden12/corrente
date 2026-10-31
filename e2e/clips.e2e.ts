import { test, expect, type Page } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Clip pool rail: the default project seeds one instrument track (selected), so its
 * clip rail is visible on load. Guards adding a clip (the clips header's +), that it appears as
 * a chip, and that the pool persists across reload (it lives in the project snapshot).
 */

/** The clips section of the workbench column (DAW-61.1). */
const rail = (page: Page) => page.getByRole("region", { name: "Clips" });

test("adding a clip adds a chip and persists across reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const addClip = page.getByRole("button", { name: "Add a new empty clip" });
  await expect(addClip).toBeVisible();
  await expect(rail(page).getByText("Clip 1", { exact: true })).toBeVisible();

  await addClip.click();
  await expect(rail(page).getByText("Clip 2", { exact: true })).toBeVisible();

  await page.waitForTimeout(400); // let the debounced project autosave flush
  await page.reload();
  await dismissStart(page);
  await expect(rail(page).getByText("Clip 2", { exact: true })).toBeVisible();
});

test("a clip's chip shows a glance at its notes, and an empty one shows none (DAW-58)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto("/");
  await dismissStart(page);
  const chipNotes = rail(page).locator("svg rect");
  await expect(chipNotes).toHaveCount(0);

  const roll = (await page.getByTestId("roll-scroll").boundingBox())!;
  await page.mouse.dblclick(roll.x + 120, roll.y + 60);
  await page.mouse.dblclick(roll.x + 200, roll.y + 90);
  await expect(chipNotes).toHaveCount(2);

  // + makes an empty clip: its chip has no notes to show.
  await page.getByRole("button", { name: "Add a new empty clip" }).click();
  await expect(rail(page).getByText("Clip 2", { exact: true })).toBeVisible();
  await expect(chipNotes).toHaveCount(2);
});
