import { test, expect } from "@playwright/test";
import { dismissStart } from "./support/app";

/** `<name>-<date>-<version>.daw.zip` (HOST-23.2.1.2). */
const EXPORT_NAME = /^untitled-\d{4}-\d{2}-\d{2}-[0-9a-f]{6}\.daw\.zip$/;

/**
 * With no server configured (as this suite runs), the app says where its files are, calmly
 * (HOST-23.2.5): a chip in the status bar, and a line at the top of Projects, each opening the same
 * details.
 */

test.use({ viewport: { width: 1320, height: 900 } });

test("a standalone run says its files are on this device, from the status bar and from Projects", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await page.getByRole("button", { name: "Saved in browser" }).click();
  const details = page.getByRole("dialog", { name: "Saved in browser" });
  await expect(details).toContainText("saved in this browser, on this device");
  // And what the browser may do with them (HOST-23.2.1.1): headless Chromium answers either way.
  await expect(details).toContainText(/may clear them|has agreed to keep them/);
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();

  // Its export line opens the project's page, whose Export button downloads it.
  await page.getByRole("button", { name: "Saved in browser" }).click();
  await details.getByRole("button", { name: "Export from the project page" }).click();
  await expect(details).toBeHidden();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(EXPORT_NAME);

  // Already on the project's page, so the list is one step up.
  await page.getByRole("button", { name: "Back to Projects" }).click();
  const note = page.getByRole("region", { name: "Saved in browser" });
  await note.getByRole("button", { name: "Saved in browser" }).click();
  await expect(note).toContainText("To keep a copy, export your project.");
  // And the open project's card exports it too.
  const [fromCard] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export Untitled" }).click(),
  ]);
  expect(fromCard.suggestedFilename()).toMatch(EXPORT_NAME);
});
