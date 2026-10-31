/**
 * Shared e2e helpers for getting the app into a usable state.
 *
 * One copy, deliberately. `dismissStart` lived in all 27 spec files, which is why the race below
 * survived six separate sightings: each one looked like a different test being flaky rather than
 * one helper being wrong (ARCH-5).
 */
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * A phone's Studio as it opened before it started quiet (MOBILE-34): the sheet at Half, with the roll,
 * the devices and the keys unfolded. For tests about the editor rather than about what a first visit sees.
 * Only where nothing is stored yet, so a test that reloads still sees what it left.
 */
export async function phoneEditorOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const opened = {
      "corrente:sheet-detent": "half",
      "corrente:roll-open:compact": "true",
      "corrente:devices-open:compact": "true",
      "corrente:keys-open": "true",
    };
    for (const [key, value] of Object.entries(opened))
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  });
}

/**
 * Clear the "Start the audio engine" overlay, which every spec has to do before it can touch
 * anything.
 *
 * **Waits for the dialog rather than sampling for it**, and that is the whole point. This used to
 * read `if (await start.count()) { ... }`, and `count()` is a point-in-time sample: `AppShell`
 * renders `{!started && <StartDialog/>}` from mount until it is clicked, so a count of zero means
 * the page has not mounted yet far more often than it means the engine is already running. Under
 * parallel load the guard saw zero, skipped the click, and the overlay then appeared over a test
 * that believed it had gone - intercepting every click until the test timed out 30 seconds later.
 *
 * Every call site runs straight after a `goto` or a `reload`, so the dialog is always freshly
 * mounted and waiting for it is safe. If a future flow starts the engine without it, this fails
 * with "waiting for start audio button" rather than silently skipping, which is the better way
 * round: that is a change worth noticing.
 */
export async function dismissStart(page: Page): Promise<void> {
  const start = page.getByRole("button", { name: /start audio/i });
  await start.waitFor({ state: "visible" });
  await start.click();
  // engine.start() awaits the worklet modules, so the overlay clears (and the layout settles) a
  // beat after the click - interacting before that races the re-layout.
  await expect(start).toHaveCount(0);
}

/**
 * Go to the Studio on the touch shell, which opens on Explore on a first visit (2026-10-22). A
 * no-op on the desktop shell, which has no tabs.
 */
export async function openStudio(page: Page): Promise<void> {
  const studio = page.getByRole("navigation", { name: "Places" }).getByRole("button", { name: "Studio", exact: true });
  if (await studio.isVisible()) await studio.click();
}

/**
 * Open the settings panel on its Timing page (tempo, meter, metronome, count-in, groove - MOBILE-19),
 * from the account button on either shell. The panel reopens on the page it was closed on, so on a
 * phone the category list is only there to tap on the first opening.
 */
export async function openTimingSettings(page: Page): Promise<void> {
  await openSettingsPage(page, "Timing");
  // Scoped to the panel: the desktop transport has a tempo field of its own.
  await expect(page.getByRole("dialog").getByRole("spinbutton", { name: "Tempo", exact: true })).toBeVisible();
}

/**
 * Open the settings panel on one of its pages, from the account button on either shell, or switch
 * page if it is already open.
 */
export async function openSettingsPage(page: Page, name: string): Promise<void> {
  const close = page.getByRole("button", { name: "Close settings" });
  if (!(await close.isVisible())) await page.getByRole("button", { name: "Account and settings" }).click();
  const tab = page.getByRole("tab", { name, exact: true });
  // Reopening lands on the page it was closed on, where a phone hides the list.
  if (await tab.isVisible()) await tab.click();
  else
    await page
      .getByRole("button", { name: "All settings" })
      .click()
      .then(() => tab.click());
  await expect(page.getByRole("tabpanel", { name })).toBeVisible();
}

/** Set the count-in from the Timing page and close the panel again. */
export async function setCountIn(page: Page, choice: "None" | "1 bar" | "2 bars"): Promise<void> {
  await openTimingSettings(page);
  await page.getByRole("radio", { name: choice }).click();
  await page.getByRole("button", { name: "Close settings" }).click();
}

/**
 * Open an Explore category page (COMM-1.9.1) from wherever Explore is: home, or another category.
 * Explore must already be on screen (the desktop library's default view, or the phone's tab).
 */
export async function openExploreCategory(page: Page, label: string): Promise<void> {
  const back = page.getByRole("button", { name: "Back to Explore" });
  if (await back.isVisible()) await back.click();
  await page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
  await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
}

/**
 * Your preview track's editor (COMM-1.4.5): the desktop's Preview tab, or a phone's preview sheet. The
 * one on screen: a phone's Studio sheet may hold it too, hidden behind another tab.
 */
export const previewEditor = (page: Page) =>
  page.locator('[data-testid="workbench-column"]:has([data-testid="preview-bar"]):visible');

/** Use the preview on a track from its "Use on…" menu: `onto` (else the first track listed), then `how`. */
export async function pickUseOn(
  page: Page,
  how: "Replace its sound" | "Add just the devices",
  onto?: string,
  press: "click" | "tap" = "click",
): Promise<void> {
  const go = (locator: Locator) => (press === "tap" ? locator.tap() : locator.click());
  await go(previewEditor(page).getByRole("button", { name: "Use on a track" }));
  await go(onto ? page.getByRole("menuitem", { name: onto }) : page.getByRole("menuitem").first());
  await go(page.getByRole("menuitem", { name: how }));
}

/**
 * Take an instrument or patch from Explore onto a track: tapping its row only tries it on your
 * preview (COMM-1.4.1, COMM-1.4.5), and its "Use on…" is what changes the track.
 */
export async function swapFromExplore(page: Page, name: string, how: "click" | "tap" = "click"): Promise<void> {
  const row = page.getByTestId("explore-row").getByRole("button", { name, exact: true });
  await (how === "tap" ? row.tap() : row.click());
  await pickUseOn(page, "Replace its sound", undefined, how);
}

/**
 * Open the desktop's view of the open project. Choosing the Project view opens on the open
 * project's page (its tracks, in group cards), with the list of projects one step up (DAW-58).
 */
export async function openProjectTracks(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to Projects" })).toBeVisible();
}

/** Open the desktop's list of projects: the Project view, then one step up from the open project. */
export async function openProjectList(page: Page): Promise<void> {
  await openProjectTracks(page);
  await page.getByRole("button", { name: "Back to Projects" }).click();
  await expect(page.getByRole("list", { name: "Projects" })).toBeVisible();
}

/** The open project's row on the Projects page (desktop's Project view, on its home page). */
export const openProjectRow = (page: Page) =>
  page
    .getByRole("list", { name: "Projects" })
    .getByRole("listitem")
    .filter({ has: page.locator('[aria-current="true"]') });

/** Pick one of the open project's row actions (Rename…, Export…, Delete). */
export async function openRowAction(page: Page, action: string): Promise<void> {
  await openProjectRow(page)
    .getByRole("button", { name: /^Options for / })
    .click();
  await page.getByRole("menuitem", { name: action }).click();
}

/** Make a project from the desktop Projects page's New menu, taking the name dialog's default. */
export async function createProjectFromList(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New project…" }).click();
  await page.getByRole("button", { name: "Create" }).click();
}

/** Open a group's card on the project page (cards start closed); a no-op if it is already open. */
export async function openGroupCard(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole("region", { name }).getByRole("button", { name: new RegExp(`^${name}`) });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
