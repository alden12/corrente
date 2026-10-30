import { test, expect } from "@playwright/test";
import { dismissStart, openExploreCategory } from "./support/app";

/** A device's graph (INST-44) opens as an editor tab (DAW-89), from the rack or from Explore. */

test.use({ viewport: { width: 1320, height: 900 } });

const tabs = (page: import("@playwright/test").Page) =>
  page.getByRole("tablist", { name: "Open editors" }).getByRole("tab");

test("a device's graph opens in a tab beside its track, from the rack and from Explore", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // From the seed track's instrument (a Micro VA) in the rack.
  await page.getByRole("button", { name: "View Micro VA's graph" }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs(page).nth(1)).toContainText("graph");
  // Its blocks are drawn, by their node names.
  await expect(page.locator(".react-flow__node").first()).toBeVisible();

  // Back to the track's tab: the rack again.
  await tabs(page).first().click();
  await expect(page.getByRole("button", { name: "View Micro VA's graph" })).toBeVisible();

  // From an effect's row in Explore.
  await openExploreCategory(page, "Effects");
  await page.getByRole("button", { name: "Actions: Reverb" }).click();
  await page.getByRole("menuitem", { name: "View device graph" }).click();
  await expect(tabs(page)).toHaveCount(3);
  await expect(tabs(page).nth(2)).toContainText("Reverb");
});

test("a track's whole chain opens as one graph, its devices in frames that fold", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // An arpeggiator before the seed track's Micro VA, and a reverb after it.
  await openExploreCategory(page, "MIDI devices");
  await page.getByRole("button", { name: 'Add "Arpeggiator" to the selected track' }).click();
  await openExploreCategory(page, "Effects");
  await page.getByRole("button", { name: 'Add "Reverb" to the selected track' }).click();

  await page.getByRole("button", { name: "Device chain actions" }).click();
  await page.getByRole("menuitem", { name: "View chain graph" }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toContainText("chain");

  // A frame per device, in chain order, joined by a link each.
  const frames = page.locator(".react-flow__node-frame");
  await expect(frames).toHaveCount(3);
  await expect(frames.nth(0)).toContainText("Arpeggiator");
  await expect(frames.nth(1)).toContainText("Micro VA");
  await expect(frames.nth(2)).toContainText("Reverb");
  await expect(page.locator('.react-flow__edge[data-id^="link:"]')).toHaveCount(2);

  // A drag on a frame's background pans the view, rather than moving the frame.
  const viewport = page.locator(".react-flow__viewport");
  const before = await viewport.getAttribute("style");
  const frame = await frames.nth(0).boundingBox();
  // Its header's top edge: clear of the boxes inside.
  await page.mouse.move(frame!.x + frame!.width / 2, frame!.y + 2);
  await page.mouse.down();
  await page.mouse.move(frame!.x + frame!.width / 2 - 100, frame!.y + 42, { steps: 5 });
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute("style", before!);
  await page.getByRole("button", { name: "Fit View" }).click();

  // Folding the instrument leaves one box for it, still linked.
  const boxes = await page.locator(".react-flow__node").count();
  await page.getByRole("button", { name: "Fold Micro VA" }).click();
  await expect(page.getByRole("button", { name: "Open Micro VA" })).toBeVisible();
  expect(await page.locator(".react-flow__node").count()).toBeLessThan(boxes);
  await expect(page.locator('.react-flow__edge[data-id^="link:"]')).toHaveCount(2);
});

test("a tab opened past the bar's edge scrolls into view", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openExploreCategory(page, "Effects");
  // Enough graph tabs to run past the bar's width; each opens shown.
  for (const effect of ["Reverb", "Chorus", "Flanger", "Phaser", "Tremolo", "Widener", "Lo-Fi"]) {
    await page.getByRole("button", { name: `Actions: ${effect}` }).click();
    await page.getByRole("menuitem", { name: "View device graph" }).click();
    await expect(tabs(page).last()).toBeInViewport();
  }
  await expect(tabs(page).first()).not.toBeInViewport();
});
