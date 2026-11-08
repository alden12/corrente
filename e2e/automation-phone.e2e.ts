import { test, expect } from "@playwright/test";
import { dismissStart, openStudio, phoneEditorOpen } from "./support/app";

/**
 * Automation on a phone (DAW-67.8): the section in the editor sheet, drawn by taps, with what a
 * double-click or a right-click does on a desktop reachable by a finger.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("a phone makes, draws and edits automation with taps", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("corrente:sheet-detent", "full"));
  await phoneEditorOpen(page);
  await page.goto("/");
  await dismissStart(page);
  await openStudio(page);

  const section = page.getByTestId("automation-section");
  await section.getByRole("button", { name: "Add automation" }).tap();
  const chip = section.getByTestId("automation-chip");
  await expect(chip).toHaveCount(1);
  expect((await chip.boundingBox())!.height, "a finger-sized chip").toBeGreaterThanOrEqual(36);

  // A tap on the curve adds a point there; picked, it can be deleted without a double-click.
  const editor = section.getByTestId("curve-editor");
  await editor.scrollIntoViewIfNeeded();
  const box = (await editor.boundingBox())!;
  await editor.tap({ position: { x: box.width * 0.6, y: box.height * 0.3 } });
  const points = editor.getByTestId("curve-point");
  await expect(points).toHaveCount(2);
  const remove = section.getByRole("button", { name: "Delete point" });
  expect((await remove.boundingBox())!.height, "a finger-sized button").toBeGreaterThanOrEqual(40);
  await remove.tap();
  await expect(points).toHaveCount(1);

  // Binding opens the devices, folded on a phone, so there are knobs to tap.
  await section.getByRole("button", { name: "+ Bind a knob" }).tap();
  const column = page.getByTestId("workbench-column");
  const sections = column.getByRole("group").locator('button[aria-expanded="false"]:not([aria-haspopup])');
  await expect(sections.first()).toBeAttached();
  await sections.first().tap();
  await expect(page.getByTestId("bind-knob").first()).toBeAttached();
  await section.getByRole("button", { name: "Done" }).tap();

  // A shape is a tap away, at a finger's size.
  await points.first().dispatchEvent("pointerdown", { button: 0, pointerType: "touch", isPrimary: true });
  const sine = section.getByRole("button", { name: "Sine" });
  expect((await sine.boundingBox())!.height).toBeGreaterThanOrEqual(40);
});
