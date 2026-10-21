import { test, expect, type Page } from "@playwright/test";
import {
  createProjectFromList,
  dismissStart,
  openExploreCategory,
  swapFromExplore,
  openProjectList,
} from "./support/app";

/**
 * The activity rail + toolbar (the VSCode-style spine). Guards: the rail switches
 * the single library view; clicking the active icon collapses the panel to the
 * rail and it persists across a reload; the toolbar carries undo/redo + MCP; the
 * Project view creates a project that survives a reload; and an empty Sampler
 * picker reveals Explore's Samples page.
 */

test.use({ viewport: { width: 1320, height: 900 } });

const libPanel = (page: Page) => page.locator('[class*="grid-area:library"]');
const libWidth = (page: Page) => libPanel(page).evaluate((el) => el.getBoundingClientRect().width);

test("the rail switches the single library view", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Explore is the default view (its title shows in the panel header).
  await expect(page.getByText("Explore", { exact: true })).toBeVisible();

  await openProjectList(page);
  await expect(page.getByRole("searchbox", { name: "Filter projects" })).toBeVisible();

  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page.getByRole("combobox", { name: "Activity view" })).toBeVisible();
});

test("clicking the active rail icon collapses the panel to the rail, and it persists", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  expect(await libWidth(page)).toBeGreaterThan(150);

  // Clicking the active (Explore) icon collapses the panel away (only the rail
  // remains, which is now its own full-height column).
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  await expect(libPanel(page)).toHaveCount(0);

  // Collapse persists across a reload.
  await page.reload();
  await dismissStart(page);
  await expect(libPanel(page)).toHaveCount(0);

  // Selecting a different view reopens the panel on that view.
  await page.getByRole("button", { name: "Activity" }).click();
  await expect.poll(() => libWidth(page)).toBeGreaterThan(150);
  await expect(page.getByRole("combobox", { name: "Activity view" })).toBeVisible();
});

test("Explore's search finds devices, grouped by kind", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // The rail's Search icon is a way into Explore's search, from any view, with the box focused.
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search Explore" });
  await expect(search).toBeFocused();

  // Devices only, grouped by category: the project's own tracks are searched where they live.
  await search.fill("subtractive");
  await expect(
    page.getByRole("region", { name: "Instruments" }).getByRole("button", { name: "Subtractive", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Tracks" })).toHaveCount(0);
  await search.fill("#bass");
  await expect(page.getByRole("region", { name: "Patches" })).toBeVisible();

  // Forgiving spelling: a word like nothing listed is read as the nearest, and the count says so.
  await search.fill("glasy");
  await expect(page.getByText("“glassy” (you typed “glasy”)")).toBeVisible();
  await expect(page.getByRole("region", { name: "Patches" })).toBeVisible();
});

test("the header has undo and redo", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  // (The MCP indicator lives in the workbench tab bar but is connection-gated - shown only when the
  // dev/local bridge is actually connected, so it isn't a second bare dot beside the sync chip. That
  // state differs between a dev machine with a bridge and CI without one, so it isn't asserted here;
  // its absence is never a warning either, as the built-in agent does not need MCP.)
  // Undo and redo sit in the library header, from whichever view the panel shows.
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeVisible();
});

test("the Projects page creates a project that survives a reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Open the Project view: one project is listed.
  await openProjectList(page);
  const rows = page.getByRole("list", { name: "Projects" }).getByRole("listitem");
  await expect(rows).toHaveCount(1);
  await createProjectFromList(page);
  await expect(rows).toHaveCount(2);
  await page.waitForTimeout(500); // let the create + save settle

  // The second project persists across a reload (the Projects view is persisted too).
  await page.reload();
  await dismissStart(page);
  await expect(rows).toHaveCount(2);
});

test("an empty Sampler picker reveals the Samples page", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Apply the Sampler to the seed track, then clear its sample.
  await openExploreCategory(page, "Instruments");
  await swapFromExplore(page, "Sampler");
  const picker = page.getByRole("combobox", { name: /Sample/ });
  await picker.selectOption({ label: "None" });

  // The empty picker offers a "browse the library" affordance that jumps to Samples.
  await page.getByRole("button", { name: "Browse samples in the library" }).click();
  await expect(page.getByRole("heading", { name: "Samples", exact: true })).toBeVisible();
});

test("an unsized library panel opens narrower on a small window, and follows the window as it grows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  await dismissStart(page);
  // 1024 leaves the middle 560px: each side panel gets (1024 - 560) / 2.
  await expect.poll(() => libWidth(page)).toBe(232);
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(() => libWidth(page)).toBe(350);
});
