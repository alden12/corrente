import { test, expect } from "@playwright/test";
import { dismissStart, openExploreCategory, openGroupCard, openProjectTracks } from "./support/app";

/**
 * Inside a project (MOBILE-19.3): its name, chips for tempo / meter / length, and its groups as
 * cards - each track one row with its device chain, mute / solo and a level fader.
 * Choosing a track drives the workbench (selection is one shared value).
 */

test.use({ viewport: { width: 1320, height: 900 } });

/** The project page's track rows live in the library column; the timeline has its own track headers. */
const tracks = (page: import("@playwright/test").Page) => page.locator('[class*="grid-area:library"]');

test("a track's row shows its chain and mutes it", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);
  await openGroupCard(page, "main");

  await expect(tracks(page).getByTestId("tree-track")).toHaveCount(1);
  await expect(tracks(page).getByText("Micro VA", { exact: true })).toBeVisible();
  await tracks(page).getByRole("button", { name: "Mute Micro VA 1" }).click();
  await expect(tracks(page).getByRole("button", { name: "Unmute Micro VA 1" })).toHaveAttribute("aria-pressed", "true");
  // The group mutes as a whole from its card.
  await tracks(page).getByRole("button", { name: "Mute main" }).click();
  await expect(tracks(page).getByRole("button", { name: "Unmute main" })).toBeVisible();
});

test("selecting a track in the list selects it in the workbench", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Add a Sampler as a NEW track via its "+" in Explore (the row's primary click would
  // instead apply it to the selected seed track). It becomes selected, so the workbench
  // tab's kind chip = sampler.
  await openExploreCategory(page, "Instruments");
  await page.getByRole("button", { name: 'Add "Sampler" as a new track', exact: true }).click();
  await expect(page.getByRole("tablist").getByText("sampler", { exact: true })).toBeVisible();

  // In the Tracks list, select the seed (Micro VA) track -> the workbench follows.
  await openProjectTracks(page);
  await openGroupCard(page, "main");
  await tracks(page).getByTestId("tree-track").filter({ hasText: "Micro VA" }).click();
  await expect(page.getByRole("tablist").getByText("micro-va", { exact: true })).toBeVisible();

  // The filter narrows the list by name.
  await page.getByRole("searchbox", { name: "Filter tracks" }).fill("zzz");
  await expect(tracks(page).getByTestId("tree-track")).toHaveCount(0);
});

test("add an empty track from a group, then assign it an instrument", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);
  await openGroupCard(page, "main");

  // The "main" group's + button opens a menu; "New MIDI track" adds an empty
  // instrument track (no instrument yet); it is selected.
  await page.getByRole("button", { name: /Add a track to main/i }).click();
  await page.getByRole("menuitem", { name: "New MIDI track" }).click();
  await expect(page.getByRole("tablist").getByText("empty", { exact: true })).toBeVisible();
  await expect(tracks(page).getByText("No instrument")).toBeVisible();
  await expect(page.getByText("This track has no instrument yet. Choose one:")).toBeVisible();

  // Picking an instrument assigns it - the tab's kind chip becomes that instrument.
  await page.getByRole("button", { name: "FM", exact: true }).click();
  await expect(page.getByRole("tablist").getByText("fm", { exact: true })).toBeVisible();
});

test("assign the Nimbus synth to a track and see its controls", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);
  await openGroupCard(page, "main");

  await page.getByRole("button", { name: /Add a track to main/i }).click();
  await page.getByRole("menuitem", { name: "New MIDI track" }).click();
  await page.getByRole("button", { name: "Nimbus", exact: true }).click();

  // The tab's kind chip becomes the instrument, and its schema-driven controls render.
  await expect(page.getByRole("tablist").getByText("nimbus", { exact: true })).toBeVisible();
  await expect(page.getByText("Pulse Width", { exact: true })).toBeVisible();
});

test("add an empty audio track from a group's + menu", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);
  await openGroupCard(page, "main");

  // The + menu's "New audio track" adds an empty audio track; it is selected and its
  // tab kind chip reads "audio", with the empty audio-clip panel in the workbench.
  await page.getByRole("button", { name: /Add a track to main/i }).click();
  await page.getByRole("menuitem", { name: "New audio track" }).click();
  await expect(page.getByRole("tablist").getByText("audio", { exact: true })).toBeVisible();
  await expect(page.getByText("No audio clip.")).toBeVisible();
});

test("the project's chips open the Timing settings", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);
  await openGroupCard(page, "main");

  await page.getByRole("button", { name: /BPM$/ }).click();
  await expect(page.getByRole("dialog").getByRole("tab", { name: "Timing" })).toHaveAttribute("aria-selected", "true");
});

test("group cards start closed, an opened one stays open across a reload, and + Group adds another", async ({
  page,
}) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectTracks(page);

  const main = tracks(page).getByRole("region", { name: "main" });
  const toggle = main.getByRole("button", { name: /^main/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(main.getByText(/1 track · 1 clip/)).toBeVisible();
  await expect(main.getByTestId("tree-track")).toHaveCount(0);
  await toggle.click();
  await expect(main.getByTestId("tree-track")).toHaveCount(1);

  // Open is this device's, and outlives a reload. The panel reopens on the project page by itself.
  await page.reload();
  await dismissStart(page);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(main.getByTestId("tree-track")).toHaveCount(1);

  await page.getByRole("button", { name: "+ Group" }).click();
  await expect(tracks(page).getByRole("region")).toHaveCount(2);
});
