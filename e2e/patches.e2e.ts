import { test, expect } from "@playwright/test";
import { dismissStart, openExploreCategory } from "./support/app";

/**
 * Patches: save the selected instrument track (its instrument + params + effect
 * chain) as a named entry in the library, then add a new track from it. The patch
 * library is global (IndexedDB on the device, COMM-1.11.1), so it shows up on Explore's
 * Patches page across projects.
 */

test.use({ viewport: { width: 1320, height: 900 } });

test("save an instrument as a patch, then add a track from it", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const trackHeaders = page.getByTitle("Double-click to rename");
  const before = await trackHeaders.count();

  // Open the Patches page: factory presets only until something is saved.
  await openExploreCategory(page, "Patches");
  const patchEntry = page.getByRole("button", { name: "Brass Pluck", exact: true });
  await expect(patchEntry).toHaveCount(0);

  // Save the selected (seed) track as a patch.
  await page.getByRole("button", { name: "Device chain actions" }).click();
  await page.getByRole("menuitem", { name: "Save as patch…" }).click();
  await page.getByPlaceholder("Patch name…").fill("Brass Pluck");
  await page.getByLabel("Tags, separated by commas").fill("Pluck, brassy");
  await page.getByPlaceholder("Patch name…").press("Enter");

  // It appears on the Patches page.
  await expect(patchEntry).toBeVisible();

  // The row's "+" adds it as a new track (the row's primary click applies to the
  // current track instead - covered by the audition test below).
  await page.getByRole("button", { name: 'Add "Brass Pluck" as a new track' }).click();
  await expect(trackHeaders).toHaveCount(before + 1);

  // The patch survives a reload (it is global, not part of the project bundle), and so
  // does the page Explore was left on.
  await page.reload();
  await dismissStart(page);
  await expect(page.getByRole("button", { name: "Brass Pluck", exact: true })).toBeVisible();

  // Its tags find it, as typed in the save form.
  await page.getByRole("button", { name: "Back to Explore" }).click();
  await page.getByRole("searchbox", { name: "Search Explore" }).fill("#brassy");
  await expect(page.getByRole("button", { name: "Brass Pluck", exact: true })).toBeVisible();
});

test("patches saved before the library move into it, once", async ({ page }) => {
  const old = [
    {
      id: "pt-old00001",
      name: "Old Keepsake",
      author: "you",
      instrumentType: "nimbus",
      params: {},
      effects: [],
      createdAt: 1,
    },
  ];
  await page.addInitScript((patches) => {
    // Only before the first load: the move-in clears the key, and a reload mustn't put it back.
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("corrente:patches:v1", JSON.stringify(patches));
      sessionStorage.setItem("seeded", "1");
    }
  }, old);
  await page.goto("/");
  await dismissStart(page);
  await openExploreCategory(page, "Patches");
  await expect(page.getByRole("button", { name: "Old Keepsake", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("corrente:patches:v1"))).toBeNull();

  await page.reload();
  await dismissStart(page);
  await expect(page.getByRole("button", { name: "Old Keepsake", exact: true })).toBeVisible();
});

test("a factory patch adds as a new track from its +", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const trackHeaders = page.getByTitle("Double-click to rename");
  const before = await trackHeaders.count();

  await openExploreCategory(page, "Patches");
  await page.getByRole("button", { name: 'Add "Warm Strings" as a new track' }).click();
  await expect(trackHeaders).toHaveCount(before + 1);
});

test("clicking a patch tries it without touching the project; Swap applies it to the selected track", async ({
  page,
}) => {
  await page.goto("/");
  await dismissStart(page);

  const trackHeaders = page.getByTitle("Double-click to rename");
  const before = await trackHeaders.count();
  // The seed track is a Micro VA.
  const kind = (name: string) => page.getByRole("tablist").getByText(name, { exact: true });
  await expect(kind("micro-va")).toBeVisible();

  // The primary click only tries it (COMM-1.4.1): the try panel opens, the track is unchanged.
  await openExploreCategory(page, "Patches");
  await page.getByRole("button", { name: "Warm Strings", exact: true }).click();
  const trying = page.getByRole("region", { name: "Trying Warm Strings" });
  await expect(trying).toBeVisible();
  await expect(kind("micro-va")).toBeVisible();

  // Swap is the edit: the selected track becomes nimbus, no track is added, the panel closes.
  await trying.getByRole("button", { name: /^Swap onto/ }).click();
  await expect(kind("nimbus")).toBeVisible();
  await expect(trackHeaders).toHaveCount(before);
  await expect(trying).toHaveCount(0);
});

test("tag chips narrow a category together, and search finds by #tag (COMM-1.9.1)", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await openExploreCategory(page, "Patches");
  await page.getByRole("group", { name: "Filter by tag" }).getByRole("button", { name: "#pad", exact: true }).click();
  await expect(page.getByRole("button", { name: "Glass Pad", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deep Sub", exact: true })).toHaveCount(0);

  // Tags narrow together: the row re-ranks to what goes with #pad, and a second pick refines it.
  await page.getByRole("group", { name: "Filter by tag" }).getByRole("button", { name: "#airy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Glass Pad", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Warm Strings", exact: true })).toHaveCount(0);

  // "More tags" has every tag on the page, grouped, beyond the short ranked row.
  await page.getByRole("button", { name: "More tags" }).click();
  await expect(page.getByRole("group", { name: "All tags" }).getByRole("button", { name: "#gritty" })).toBeVisible();

  await page.getByRole("button", { name: "Back to Explore" }).click();
  await page.getByRole("searchbox", { name: "Search Explore" }).fill("#space");
  // In the results' Effects group: the starter Micro VA has sections named Delay and Chorus too.
  const effects = page.getByRole("region", { name: "Effects" });
  await expect(effects.getByRole("button", { name: "Reverb", exact: true })).toBeVisible();
  await expect(effects.getByRole("button", { name: "Delay", exact: true })).toBeVisible();
  await expect(effects.getByRole("button", { name: "Chorus", exact: true })).toHaveCount(0);
});
