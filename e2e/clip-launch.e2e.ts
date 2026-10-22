import { test, expect, type Page } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Clip launching (mode-less Session): launching a clip from the rail makes it loop
 * over the transport, overriding the track's timeline. The lane greys, with a button
 * saying what's playing and what it goes back to, which pressing does (DAW-79). The
 * launched state is saved (part of the composition) so it survives a reload.
 */

test.use({ viewport: { width: 1320, height: 900 } });

const launchBtn = (page: Page) => page.getByTitle(/Launch clip/).first();
const backToTimeline = (page: Page) => page.getByTestId("lane").getByRole("button", { name: /back to/ });

/** Open the Activity rail view so the edit feed is visible. */
async function openActivity(page: Page) {
  await page.getByRole("button", { name: "Activity", exact: true }).click();
}

test("launch a clip from the rail; the lane says so; back to the timeline", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openActivity(page);

  // No clip launched yet -> nothing on the lane.
  await expect(backToTimeline(page)).toHaveCount(0);

  await launchBtn(page).click();
  await expect(backToTimeline(page)).toHaveText(/Playing Clip 1\s*·\s*back to the timeline/);
  await expect(page.getByText("Launched clip")).toBeVisible(); // feed entry

  await backToTimeline(page).click();
  await expect(backToTimeline(page)).toHaveCount(0); // back to the arrangement
});

test("a launched clip is saved and survives a reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await launchBtn(page).click();
  await expect(backToTimeline(page)).toBeVisible();

  await page.waitForTimeout(400); // let the debounced autosave flush
  await page.reload();
  await dismissStart(page);

  await expect(backToTimeline(page)).toBeVisible(); // launched state restored
});
