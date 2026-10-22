import { test, expect } from "@playwright/test";
import { dismissStart, openStudio, openSettingsPage } from "./support/app";

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

test("the chip asks to back up a week after a change, until it's exported, put off or turned off", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await dismissStart(page);
  const chip = page.getByRole("button", { name: "Saved in browser" });
  const asking = page.getByRole("button", { name: "Back up?" });
  const details = page.getByRole("dialog", { name: "Saved in browser" });
  const week = 7 * 24 * 60 * 60 * 1000;
  const change = async () => {
    await page.getByTestId("placement").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
  };

  // A change, then a week without an export: the chip asks, and names the project.
  await change();
  await page.clock.fastForward(5000);
  await expect(chip).toBeVisible();
  await page.clock.fastForward(week);
  await asking.click();
  await expect(details).toContainText("This project has 1 change since you last exported it");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    details.getByRole("button", { name: "Export this project" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(EXPORT_NAME);
  // Exported, so nothing to ask about.
  await expect(chip).toBeVisible();
  await page.keyboard.press("Escape");

  // Not now puts it away until the next week.
  await change();
  await page.clock.fastForward(week + 5000);
  await asking.click();
  await details.getByRole("button", { name: "Not now" }).click();
  await expect(chip).toBeVisible();
  await page.keyboard.press("Escape");
  await page.clock.fastForward(week + 60_000);

  // Don't ask me again turns it off, and says how to turn it back on.
  await asking.click();
  await details.getByRole("button", { name: "Don't ask me again" }).click();
  await expect(details).toContainText("Backup reminders are off.");
  await expect(chip).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the top bar has the laptop, which opens the same details and asks to back up there", async ({ page }) => {
    await page.clock.install();
    await page.goto("/");
    await dismissStart(page);
    await openStudio(page);
    await page.getByRole("button", { name: "Group actions" }).first().tap();
    await page.getByRole("menuitem", { name: "Add MIDI track" }).tap();
    await page.clock.fastForward(8 * 24 * 60 * 60 * 1000);
    await page.getByRole("button", { name: "Back up?" }).tap();
    const details = page.getByRole("dialog", { name: "Saved in browser" });
    await expect(details).toContainText("since you last exported it");
    await details.getByRole("button", { name: "Not now" }).tap();
    await expect(page.getByRole("button", { name: "Saved in browser" })).toBeVisible();
  });
});

test("the start card welcomes a standalone run, every load, and Account settings has the details", async ({ page }) => {
  await page.goto("/");
  const start = page.getByRole("dialog", { name: "Start the audio engine" });
  await expect(start).toContainText("Welcome to Corrente");
  await expect(start.getByRole("region", { name: "Local only" })).toContainText("export your projects regularly");
  await expect(start.getByRole("link", { name: "Source on GitHub" })).toBeVisible();
  await dismissStart(page);

  await page.reload();
  await expect(start).toContainText("Welcome to Corrente");
  await dismissStart(page);

  await openSettingsPage(page, "Account");
  await expect(page.getByRole("region", { name: "Saved in browser" })).toContainText(
    "saved in this browser, on this device",
  );
});

test("Share is still there on a standalone run, and says it needs Corrente online", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Saved in browser" }).click();
  await page
    .getByRole("dialog", { name: "Saved in browser" })
    .getByRole("button", { name: "Export from the project page" })
    .click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sharing is part of Corrente online" })).toContainText(
    "Sharing is part of Corrente online",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Sharing is part of Corrente online" })).toBeHidden();
});
