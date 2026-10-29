import { test, expect, type Page } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * The desktop's editor tabs (DAW-89): selecting a track shows it in the one preview tab, which the
 * next selection replaces; double-clicking keeps it; × closes it; renaming is in the right-click menu.
 * Saving them per project is the unit tests' (a reload here opens a fresh project).
 */

test.use({ viewport: { width: 1320, height: 900 } });

const tabs = (page: Page) => page.getByRole("tablist", { name: "Open editors" }).getByRole("tab");
/** The arrangement's track rows (not groups), by their ⋮, and the name in each. */
const trackRow = (page: Page, index: number) =>
  page
    .getByRole("button", { name: "Track actions", exact: true })
    .nth(index)
    .locator("xpath=ancestor::div[contains(@class, 'cursor-pointer')][1]");
const trackNames = {
  nth: (page: Page, index: number) => trackRow(page, index).getByTitle("Double-click to rename"),
};

test("selections share a preview tab until one is kept, × closes, and renaming is in the menu", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Two more tracks, so there are three to move between.
  await page.getByRole("button", { name: "Group actions" }).first().click();
  await page.getByRole("menuitem", { name: "Add MIDI track" }).click();
  await page.getByRole("button", { name: "Group actions" }).first().click();
  await page.getByRole("menuitem", { name: "Add MIDI track" }).click();
  const name = async (index: number) => (await trackNames.nth(page, index).textContent()) ?? "";
  const [first, second, third] = [await name(0), await name(1), await name(2)];

  // Clicking around reuses the one preview tab.
  await trackNames.nth(page, 0).click();
  await trackNames.nth(page, 1).click();
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveText(second);
  expect(first).not.toBe(second);

  // Kept by a double-click on the tab, the next selection opens a preview beside it.
  await tabs(page).first().dblclick();
  await trackNames.nth(page, 2).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");

  // Clicking the kept tab goes back to its track.
  await tabs(page).first().click();
  await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");

  // × closes the one shown, showing its neighbour.
  await tabs(page)
    .first()
    .getByRole("button", { name: /^Close / })
    .click();
  await expect(tabs(page)).toHaveCount(1);
  await expect(tabs(page).first()).toHaveText(third);

  // Renaming is in the right-click menu: a double-click only keeps the tab.
  await tabs(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename track" }).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Lead");
  await page.keyboard.press("Enter");
  await expect(tabs(page).first()).toHaveText("Lead");
});
