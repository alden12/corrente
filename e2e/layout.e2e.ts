import { test, expect, type Page } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Layout & resizable-panel integration. These guard the spine (rail | side panel | center, timeline;
 * the agent is one of the rail's views, DAW-87) and the drag-resize/persist behaviour -
 * including the regression where the grid had no definite height (the center
 * refused to collapse) and where a stale, oversized persisted timeline height
 * crowded the whole workbench out.
 */

const region = (page: Page, area: "library" | "center" | "timeline") => page.locator(`[class*="grid-area:${area}"]`);

/** Dismiss the audio-start modal so panels are interactive. */

async function box(page: Page, area: "library" | "center" | "timeline") {
  const b = await region(page, area).boundingBox();
  if (!b) throw new Error(`no box for ${area}`);
  return b;
}

const widthOf = (page: Page, area: "library" | "center" | "timeline") =>
  region(page, area).evaluate((el) => el.getBoundingClientRect().width);

// Each test runs in a fresh, isolated browser context, so localStorage starts
// empty - no manual clearing needed (and clearing on reload would defeat the
// persistence tests).

test("the core regions are visible on a clean load; the agent opens in the side panel", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  for (const area of ["library", "center", "timeline"] as const) {
    const b = await box(page, area);
    expect(b.width, `${area} width`).toBeGreaterThan(20);
    expect(b.height, `${area} height`).toBeGreaterThan(20);
  }
  const center = await widthOf(page, "center");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(region(page, "library").getByRole("button", { name: "New chat" })).toBeVisible();
  // It takes the library's place, so the center keeps its width.
  expect(Math.abs((await widthOf(page, "center")) - center)).toBeLessThan(2);
});

test("the activity rail spans the full height, and the timeline starts after it", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const rail = (await page.locator('[class*="grid-area:rail"]').boundingBox())!;
  const timeline = await box(page, "timeline");
  // The rail reaches the bottom of the app (its own column spanning both rows)...
  expect(Math.abs(rail.y + rail.height - (timeline.y + timeline.height))).toBeLessThan(2);
  // ...and the timeline no longer spans it - it starts at the rail's right edge.
  expect(timeline.x).toBeGreaterThanOrEqual(rail.x + rail.width - 1);
});

test("dragging the library handle resizes it and persists across reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const before = (await box(page, "library")).width;

  const handle = page.getByRole("separator", { name: "Resize library" });
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 90, hb.y + hb.height / 2, { steps: 8 });
  await page.mouse.up();

  const after = (await box(page, "library")).width;
  expect(after).toBeGreaterThan(before + 40);

  await page.reload();
  await dismissStart(page);
  const restored = (await box(page, "library")).width;
  expect(Math.abs(restored - after)).toBeLessThan(4);
});

test("an oversized persisted timeline height cannot crowd out the workbench", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("corrente:timeline-height", "5000"));
  await page.goto("/");
  await dismissStart(page);

  const center = await box(page, "center");
  const body = await box(page, "library"); // library spans the full top row height
  expect(center.height, "center keeps a minimum height").toBeGreaterThan(50);
  expect(center.height).toBeLessThanOrEqual(body.height + 1);
});

test("the agent's collapse closes the side panel to the rail, and its icon opens it again", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByRole("button", { name: /collapse agent panel/i }).click();
  await expect(region(page, "library")).toHaveCount(0);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(page.getByRole("button", { name: "New chat" })).toBeVisible();
});

test("the app's status sits at the foot of the rail, above the account button", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const rail = page.locator('[class*="grid-area:rail"]');
  const status = (await rail.getByRole("button", { name: "Saved in browser" }).boundingBox())!;
  const account = (await rail.getByRole("button", { name: "Account and settings" }).boundingBox())!;
  expect(status.y + status.height).toBeLessThanOrEqual(account.y + 1);
  // Nothing left in the workbench's tab bar but the track.
  await expect(region(page, "center").getByRole("button", { name: "Saved in browser" })).toHaveCount(0);
});
