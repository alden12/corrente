import { test, expect } from "@playwright/test";
import { dismissStart, openExploreCategory, openProjectTracks } from "./support/app";

/**
 * Inside a project (MOBILE-19.3): its name, chips for tempo / meter / length, and its tracks as a
 * file tree (DAW-83): groups nested to any depth, a track a row, mute / solo and ⋯ on hover.
 * Choosing a track drives the workbench (selection is one shared value).
 */

test.use({ viewport: { width: 1320, height: 900 } });

/** The project page's track rows live in the library column; the timeline has its own track headers. */
const tracks = (page: import("@playwright/test").Page) => page.locator('[class*="grid-area:library"]');

test("a track's row shows its chain and mutes it", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);

  await expect(tracks(page).getByTestId("tree-track")).toHaveCount(1);
  // The track is named for its instrument; its chain is in the row's title.
  await expect(tracks(page).getByTestId("tree-track")).toHaveAttribute("title", "Micro VA: Micro VA");
  await tracks(page).getByRole("button", { name: "Mute Micro VA" }).click();
  await expect(tracks(page).getByRole("button", { name: "Unmute Micro VA" })).toHaveAttribute("aria-pressed", "true");
  // The group mutes as a whole from its row.
  await tracks(page).getByRole("button", { name: "Mute main" }).click();
  await expect(tracks(page).getByRole("button", { name: "Unmute main" })).toBeVisible();
});

test("a playhead crosses the clip strips while the transport runs", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);

  // A line on each strip with clips (the open group's is empty, so none there), hidden while stopped.
  await expect(tracks(page).getByTestId("strip-playhead")).toHaveCount(1);
  const playhead = tracks(page).getByTestId("strip-playhead").first();
  await expect(playhead).toHaveCSS("opacity", "0");

  await expect(page.getByRole("button", { name: /Play/ })).toBeEnabled();
  await page.keyboard.press("Space");
  await expect(playhead).toHaveCSS("opacity", "1");
  // It moves: its left edge leaves the strip's start.
  const strip = playhead.locator("..");
  await expect
    .poll(async () => {
      const [line, box] = await Promise.all([playhead.boundingBox(), strip.boundingBox()]);
      return line && box ? line.x - box.x : 0;
    })
    .toBeGreaterThan(2);

  await page.keyboard.press("Space");
  await expect(playhead).toHaveCSS("opacity", "0");
});

test("selecting a track in the list selects it in the workbench", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Add a Sampler as a NEW track via its "+" in Explore (the row's primary click would
  // instead apply it to the selected seed track). It becomes selected, so the workbench
  // tab's kind chip = sampler.
  await openExploreCategory(page, "Instruments");
  await page.getByRole("button", { name: 'Add "Sampler" as a new track', exact: true }).click();
  await expect(page.getByRole("tablist").getByTitle("Sampler", { exact: true })).toBeVisible();

  // In the Tracks list, select the seed (Micro VA) track -> the workbench follows.
  await openProjectTracks(page);
  await tracks(page).getByTestId("tree-track").filter({ hasText: "Micro VA" }).click();
  await expect(page.getByRole("tablist").getByTitle("Micro VA", { exact: true })).toBeVisible();

  // The filter narrows the list by name.
  await page.getByRole("button", { name: "Filter tracks by name" }).click();
  await page.getByRole("searchbox", { name: "Filter tracks" }).fill("zzz");
  await expect(tracks(page).getByTestId("tree-track")).toHaveCount(0);
});

test("add an empty track from a group, then assign it an instrument", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);

  // The "main" group's ⋯ menu: "New MIDI track" adds an empty instrument track (no instrument
  // yet); it is selected.
  await page.getByRole("button", { name: "Actions for main" }).click();
  await page.getByRole("menuitem", { name: "New MIDI track" }).click();
  await expect(page.getByRole("tablist").getByTitle("Empty", { exact: true })).toBeVisible();
  await expect(tracks(page).getByTestId("tree-track").last()).toHaveAttribute("title", /No instrument/);
  await expect(page.getByText("This track has no instrument yet. Choose one:")).toBeVisible();

  // Picking an instrument assigns it - the tab's kind chip becomes that instrument.
  await page.getByRole("button", { name: "FM", exact: true }).click();
  await expect(page.getByRole("tablist").getByTitle("FM", { exact: true })).toBeVisible();
});

test("assign the Nimbus synth to a track and see its controls", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);

  await page.getByRole("button", { name: "Actions for main" }).click();
  await page.getByRole("menuitem", { name: "New MIDI track" }).click();
  await page.getByRole("button", { name: "Nimbus", exact: true }).click();

  // The tab's kind chip becomes the instrument, and its schema-driven controls render.
  await expect(page.getByRole("tablist").getByTitle("Nimbus", { exact: true })).toBeVisible();
  // Its sections start folded: open the oscillator's.
  await page.getByRole("button", { name: "Oscillator", exact: true }).click();
  await expect(page.getByText("Pulse Width", { exact: true })).toBeVisible();
});

test("add an empty audio track from a group's ⋯ menu", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);

  // The ⋯ menu's "New audio track" adds an empty audio track; it is selected and its
  // tab kind chip reads "audio", with the empty audio-clip panel in the workbench.
  await page.getByRole("button", { name: "Actions for main" }).click();
  await page.getByRole("menuitem", { name: "New audio track" }).click();
  await expect(page.getByRole("tablist").getByTitle("Audio", { exact: true })).toBeVisible();
  await expect(page.getByText("No audio clip.")).toBeVisible();
});

test("the project's chips open the Timing settings", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);

  await page.getByRole("button", { name: /BPM$/ }).click();
  await expect(page.getByRole("dialog").getByRole("tab", { name: "Timing" })).toHaveAttribute("aria-selected", "true");
});

test("a group folds here and in the arrangement, stays folded across a reload, and nests another", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);

  const main = tracks(page).getByTestId("tree-group").filter({ hasText: "main" });
  await expect(main).toHaveAttribute("aria-expanded", "true");
  await main.click();
  await expect(main).toHaveAttribute("aria-expanded", "false");
  await expect(tracks(page).getByTestId("tree-track")).toHaveCount(0);
  // One fold: the arrangement's group is folded too (DAW-83, DAW-49).
  await expect(page.getByTitle("Expand group")).toBeVisible();

  // Folds are this device's, and outlive a reload. The panel reopens on the project page by itself.
  await page.reload();
  await dismissStart(page);
  await expect(main).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTitle("Expand group")).toBeVisible();
  await main.click();

  // A group inside a group sits a level deeper, under it.
  await page.getByRole("button", { name: "Actions for main" }).click();
  await page.getByRole("menuitem", { name: "New group inside" }).click();
  await expect(tracks(page).getByTestId("tree-group")).toHaveCount(2);
  await page.getByRole("button", { name: "Add a track or group" }).click();
  await page.getByRole("menuitem", { name: "Add group" }).click();
  await expect(tracks(page).getByTestId("tree-group")).toHaveCount(3);
});
