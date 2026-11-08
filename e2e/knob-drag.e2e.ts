import { test, expect, type Page } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * A device's fader dragged twice moves twice, and never drags the page. The first drag used to leave
 * a selection over the fader's own parts, and the second press then started a native drag of it:
 * the browser's grey globe following the pointer from the page's corner, and the fader stuck.
 */
test.use({ viewport: { width: 1400, height: 1000 } });

const drag = async (page: Page, control: ReturnType<Page["getByRole"]>, by: number) => {
  await control.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + by, { steps: 4 });
  await page.mouse.up();
};

test("a fader drags again after its first drag, without dragging the page", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await page.evaluate(() => {
    const seen = window as unknown as { nativeDrags: number };
    seen.nativeDrags = 0;
    document.addEventListener("dragstart", () => seen.nativeDrags++, true);
  });
  const column = page.getByTestId("workbench-column");
  const folded = column.getByRole("group").locator('button[aria-expanded="false"]:not([aria-haspopup])');
  while ((await folded.count()) > 0) await folded.first().click();
  const level = column.getByRole("slider", { name: "Level", exact: true }).first();

  const start = await level.getAttribute("aria-valuenow");
  await drag(page, level, -30);
  const once = await level.getAttribute("aria-valuenow");
  expect(once).not.toBe(start);
  await drag(page, level, 60);
  expect(await level.getAttribute("aria-valuenow")).not.toBe(once);
  expect(await page.evaluate(() => (window as unknown as { nativeDrags: number }).nativeDrags)).toBe(0);
});
