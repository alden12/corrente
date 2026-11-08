import { test, expect, type Page } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Automation in the workbench (DAW-67.5): a clip's curve drawn and bound to a knob from the devices
 * below, and while the transport plays, the knob follows the curve (DAW-67.2) without its own value
 * changing; a stop gives it back.
 */
test.use({ viewport: { width: 1400, height: 1000 } });

const openEveryDeviceSection = async (page: Page) => {
  const column = page.getByTestId("workbench-column");
  const folded = column.getByRole("group").locator('button[aria-expanded="false"]:not([aria-haspopup])');
  while ((await folded.count()) > 0) await folded.first().click();
};

test("a curve drawn in the workbench and bound to the level silences the track while it plays", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const scroll = page.getByTestId("arr-scroll");
  await scroll.getByRole("button", { name: "Track actions" }).first().click();
  await page.getByRole("menuitem", { name: "Add automation" }).click();

  const section = page.getByTestId("automation-section");
  await expect(section.getByTestId("automation-chip")).toHaveCount(1);
  const editor = section.getByTestId("curve-editor");
  const point = editor.getByTestId("curve-point");
  await expect(point).toHaveCount(1);

  // Drag the curve's one point to the bottom: flat at nothing. (The section is the column's last, so
  // bring it into view first.)
  await editor.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const at = (await point.boundingBox())!;
  const box = (await editor.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2, box.y + box.height - 2, { steps: 5 });
  await page.mouse.up();

  // A click on empty curve adds a point; a double-click on it takes it away again.
  await editor.click({ position: { x: box.width * 0.7, y: box.height * 0.3 } });
  await expect(point).toHaveCount(2);
  await point.nth(1).dblclick();
  await expect(point).toHaveCount(1);

  // Bind the instrument's level from the devices below.
  await section.getByRole("button", { name: "+ Bind a knob" }).click();
  await openEveryDeviceSection(page);
  const level = page.getByRole("button", { name: /^Bind Level to Automation$/ }).first();
  await level.click();
  await expect(page.getByRole("button", { name: /^Unbind Level from Automation$/ }).first()).toBeVisible();
  await section.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("bind-knob")).toHaveCount(0);
  await expect(section.getByTestId("drives-row")).toHaveCount(1);
  await expect(section.getByTestId("drives-row")).toContainText("Level");

  // The track's volume ring meters what it plays: silent under the automation while the transport
  // runs, and sounding again once it stops.
  const meter = scroll.getByRole("slider", { name: "Volume", exact: true }).first();
  const levelNow = async () => Number(await meter.getAttribute("data-level"));
  // Before playing, the knob's own value: it sounds.
  await page.keyboard.down("z");
  await expect.poll(levelNow, { timeout: 3000 }).toBeGreaterThan(0.2);
  await page.keyboard.up("z");
  await page.waitForTimeout(1500);
  await page.getByTitle("Play", { exact: true }).click();
  await page.waitForTimeout(300);
  await page.keyboard.down("z");
  await page.waitForTimeout(800);
  expect(await levelNow()).toBeLessThan(0.12);
  await page.keyboard.up("z");
  await page.getByTitle("Stop", { exact: true }).click();
  await page.waitForTimeout(300);
  await page.keyboard.down("z");
  await expect.poll(levelNow, { timeout: 3000 }).toBeGreaterThan(0.2);
  await page.keyboard.up("z");
});
