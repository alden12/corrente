import { test, expect, type Page } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Automation on the timeline (DAW-67.4): a clip added from a track's menu shows in a row above the
 * track, drags along it, folds away into a band and hides by its row's eye.
 */
test.use({ viewport: { width: 1320, height: 900 } });

const addAutomation = async (page: Page) => {
  const scroll = page.getByTestId("arr-scroll");
  await scroll.getByRole("button", { name: "Track actions" }).first().click();
  await page.getByRole("menuitem", { name: "Add automation" }).click();
};

test("a track's automation sits in a row above it, and folds and hides", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const scroll = page.getByTestId("arr-scroll");
  await addAutomation(page);

  const clip = scroll.getByTestId("automation-clip");
  await expect(clip).toHaveCount(1);
  await expect(clip).toHaveAttribute("data-selected", "true");
  await expect(scroll.getByTestId("automation-row")).toHaveCount(1);
  // Above its track: the row comes before the track's own lane.
  const rowBox = (await scroll.getByTestId("automation-row").boundingBox())!;
  const laneBox = (await scroll.getByTestId("lane").first().boundingBox())!;
  expect(rowBox.y).toBeLessThan(laneBox.y);

  // Dragged a bar to the right, it lands a bar later.
  const before = (await clip.boundingBox())!;
  await page.mouse.move(before.x + 20, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + 20 + 96, before.y + before.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await clip.boundingBox())!.x - before.x)).toBe(96);

  // A second clip overlapping the first gets a row of its own.
  await addAutomation(page);
  await expect(scroll.getByTestId("automation-row")).toHaveCount(2);

  // Folded, the rows go and a band stays.
  await scroll.getByRole("button", { name: "Fold automation (2)" }).click();
  await expect(scroll.getByTestId("automation-row")).toHaveCount(0);
  await expect(scroll.getByTestId("automation-band")).toHaveCount(1);
  await scroll.getByRole("button", { name: "Show automation (2)" }).click();

  // An eye hides a row, and the track says so until it's brought back.
  await scroll.getByRole("button", { name: "Hide this automation row" }).first().click();
  await expect(scroll.getByTestId("automation-row")).toHaveCount(1);
  await scroll.getByRole("button", { name: "1 hidden" }).click();
  await expect(scroll.getByTestId("automation-row")).toHaveCount(2);

  // Delete takes the picked one off the timeline.
  await scroll.getByTestId("automation-clip").first().click();
  await page.keyboard.press("Delete");
  await expect(scroll.getByTestId("automation-clip")).toHaveCount(1);
});
