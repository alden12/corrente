import { test, expect } from "@playwright/test";
import { dismissStart, setCountIn } from "./support/app";

/** Knob moves during a take land as an automation clip on the timeline (DAW-67.7). */
test.use({ viewport: { width: 1400, height: 1000 } });

test("a knob moved while recording becomes an automation clip", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await setCountIn(page, "None");
  const column = page.getByTestId("workbench-column");
  const folded = column.getByRole("group").locator('button[aria-expanded="false"]:not([aria-haspopup])');
  while ((await folded.count()) > 0) await folded.first().click();
  const level = column.getByRole("slider", { name: "Level", exact: true }).first();

  const record = page.getByRole("button", { name: "Record", exact: true });
  await record.click();
  await expect(record).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(400);
  await level.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const box = (await level.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await record.click();
  await expect(record).toHaveAttribute("aria-pressed", "false");

  await expect(page.getByTestId("arr-scroll").getByTestId("automation-clip")).toContainText("Level take");
  await expect(column.getByTestId("automated-mark")).toHaveCount(1);
});
