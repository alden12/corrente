import { test, expect, type Page } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Right-click menus on desktop (DAW-74): a clip on the timeline gets the actions touch has on its ⋮,
 * empty lane space what a tap's marker offers there, and a clip in the rail copy, paste and the rest.
 */

test.use({ viewport: { width: 1320, height: 900 } });

const placements = (page: Page) => page.getByTestId("placement");
const chips = (page: Page) => page.getByTitle(/drag onto the lane/);

test("a clip on the timeline duplicates from its right-click menu, and pastes into empty lane", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await expect(placements(page)).toHaveCount(1);

  await placements(page).first().click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Cut" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(placements(page)).toHaveCount(2);

  // Copy, then paste it further along the lane, from the lane's own menu.
  await placements(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy" }).click();
  // Just past the last clip: the lane runs on past the window's edge.
  const last = (await placements(page).last().boundingBox())!;
  await page.mouse.click(last.x + last.width + 30, last.y + last.height / 2, { button: "right" });
  await page.getByRole("menuitem", { name: "Paste" }).click();
  await expect(placements(page)).toHaveCount(3);

  // Escape closes a menu without choosing.
  await placements(page).first().click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Duplicate" })).toHaveCount(0);
});

test("a clip in the rail duplicates, copies and pastes from its right-click menu", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(chips(page)).toHaveCount(1);

  await chips(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(chips(page)).toHaveCount(2);

  await chips(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy" }).click();
  await chips(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paste" }).click();
  await expect(chips(page)).toHaveCount(3);
});

test("one clipboard: a clip copied in the rail pastes on the timeline, and one copied there pastes in the rail", async ({
  page,
}) => {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(placements(page)).toHaveCount(1);
  await expect(chips(page)).toHaveCount(1);

  // Rail to timeline: placed whole, just past the last clip.
  await chips(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy" }).click();
  const last = (await placements(page).last().boundingBox())!;
  await page.mouse.click(last.x + last.width + 30, last.y + last.height / 2, { button: "right" });
  await page.getByRole("menuitem", { name: "Paste" }).click();
  await expect(placements(page)).toHaveCount(2);

  // Timeline to rail: a new clip in the pool.
  await placements(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy" }).click();
  await chips(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paste" }).click();
  await expect(chips(page)).toHaveCount(2);
});
