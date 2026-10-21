import { test, expect } from "@playwright/test";
import { dismissStart, openProjectList } from "./support/app";

/**
 * With no server configured (as this suite runs), the app says where its files are, calmly
 * (HOST-23.2.5): a chip in the status bar, and a line at the top of Projects, each opening the same
 * details.
 */

test.use({ viewport: { width: 1320, height: 900 } });

test("a standalone run says its files are on this device, from the status bar and from Projects", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await page.getByRole("button", { name: "On this device" }).click();
  const details = page.getByRole("dialog", { name: "On this device" });
  await expect(details).toContainText("saved in this browser, on this device");
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();

  await openProjectList(page);
  const note = page.getByRole("region", { name: "On this device" });
  await note.getByRole("button", { name: "Saved on this device" }).click();
  await expect(note).toContainText("export a project from its ⋮ menu");
});
