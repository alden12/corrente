import { test, expect, type Page } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * An automated knob (DAW-67.6): an LFO added from its right-click menu marks it, the mark reads the
 * curve's value while the song plays, grabbing the knob overrides it, and Back to automation (on the
 * transport) or the next play hands it back.
 */
test.use({ viewport: { width: 1400, height: 1000 } });

/** Drag a control up a little, as a hand on it would. */
const nudge = async (page: Page, control: ReturnType<Page["getByRole"]>) => {
  await control.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 4 });
  await page.mouse.up();
};

/** A fresh project with an LFO on its instrument's Level, from the knob's menu, and the song playing. */
const playingAnLfo = async (page: Page) => {
  await page.goto("/");
  await dismissStart(page);
  const column = page.getByTestId("workbench-column");
  const folded = column.getByRole("group").locator('button[aria-expanded="false"]:not([aria-haspopup])');
  while ((await folded.count()) > 0) await folded.first().click();
  const level = column.getByRole("slider", { name: "Level", exact: true }).first();
  await level.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add an LFO" }).click();
  await expect(column.getByTestId("automated-mark")).toHaveCount(1);
  await expect(page.getByTestId("arr-scroll").getByTestId("automation-clip")).toContainText("Level LFO");
  await page.getByTitle("Play", { exact: true }).click();
  return { column, level };
};

test("a knob's LFO marks it and reads the song's value, and a grab waits for Back to automation", async ({ page }) => {
  const { column, level } = await playingAnLfo(page);
  await expect(column.getByTestId("automated-value")).not.toHaveText("");

  // Nothing grabs it but a hand: playing on, it stays automated.
  await page.waitForTimeout(1500);
  await expect(column.getByTestId("back-to-automation")).toHaveCount(0);

  // Moved, it's grabbed: the knob says so, and the transport offers it back.
  await nudge(page, level);
  await expect(column.getByTestId("back-to-automation")).toHaveCount(1);
  const transportBack = page.getByRole("button", { name: /Back to automation \(1\)/ });
  await transportBack.click();
  await expect(column.getByTestId("back-to-automation")).toHaveCount(0);
  await expect(transportBack).toHaveCount(0);
  await expect(column.getByTestId("automated-value")).not.toHaveText("");
  await page.getByTitle("Stop", { exact: true }).click();
});

test("a grabbed knob goes back to its automation on the next play", async ({ page }) => {
  const { column, level } = await playingAnLfo(page);
  await nudge(page, level);
  await expect(column.getByTestId("back-to-automation")).toHaveCount(1);
  await page.getByTitle("Stop", { exact: true }).click();
  await page.getByTitle("Play", { exact: true }).click();
  await expect(column.getByTestId("back-to-automation")).toHaveCount(0);
  await page.getByTitle("Stop", { exact: true }).click();
});
