import { test, expect, type Page } from "@playwright/test";
import { dismissStart, openExploreCategory, previewEditor, setCountIn, pickUseOn } from "./support/app";

/**
 * Trying things from Explore on your preview track (COMM-1.4.1, COMM-1.4.5): tapping an instrument or
 * patch makes it your preview, a track of the project that isn't in the arrangement, shown in the
 * desktop's Preview tab or a phone's preview sheet; an effect or MIDI device is tried on it, or on
 * the selected track's sound copied in. The keys and pads play it; each change is an ordinary edit;
 * New track and Use on copy it into the arrangement; recording with it in front puts the take on a
 * new track carrying that sound.
 */

const previewTab = (page: Page) => page.getByRole("tab", { name: /^Preview/ });
// The arrangement's lanes: what's on the timeline, which the preview is not.
const lanes = (page: Page) => page.getByTestId("lane");
const exploreRow = (page: Page, name: string) =>
  page.getByTestId("explore-row").getByRole("button", { name, exact: true });

test.describe("desktop", () => {
  test.use({ viewport: { width: 1320, height: 900 } });

  test("trying a sound makes it your preview, off the timeline; Create new track copies it there", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    const before = await lanes(page).count();

    await openExploreCategory(page, "Instruments");
    await exploreRow(page, "FM").click();
    await expect(previewTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(previewEditor(page).getByTestId("preview-title")).toHaveText("FM");
    await expect(exploreRow(page, "FM")).toHaveAttribute("aria-current", "true");
    await expect(lanes(page)).toHaveCount(before);

    await previewEditor(page)
      .getByRole("button", { name: /^Create new track in / })
      .click();
    await expect(lanes(page)).toHaveCount(before + 1);
    await expect(page.getByRole("tablist").getByTitle("FM", { exact: true })).toBeVisible();
    // A copy: the preview stays, to keep trying things, behind the new track's tab.
    await expect(previewTab(page)).toHaveAttribute("aria-selected", "false");
  });

  test("recording with the preview in front puts the take on a new track with that sound", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setCountIn(page, "None");
    const before = await lanes(page).count();

    await openExploreCategory(page, "Instruments");
    await exploreRow(page, "FM").click();
    await expect(previewEditor(page)).toBeVisible();

    const record = page.getByRole("button", { name: "Record", exact: true });
    await record.click();
    await expect(record).toHaveAttribute("aria-pressed", "true");
    for (const key of ["z", "x"]) {
      await page.keyboard.down(key);
      await page.waitForTimeout(120);
      await page.keyboard.up(key);
    }
    await record.click();
    await expect(record).toHaveAttribute("aria-pressed", "false");

    // One new track, carrying the sound and the take.
    await expect(lanes(page)).toHaveCount(before + 1);
    await expect(page.getByRole("tablist").getByTitle("FM", { exact: true })).toBeVisible();
    await expect(lanes(page).getByText("Take 1")).toBeVisible();

    // ... and it was one edit: a single undo takes the track and the take together.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(lanes(page)).toHaveCount(before);
  });

  test("the preview is a tab like a track's: it stays when Explore is left, behind another tab", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await openExploreCategory(page, "Instruments");
    await exploreRow(page, "FM").click();
    await expect(previewEditor(page)).toBeVisible();

    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(previewEditor(page)).toBeVisible();

    await page.getByRole("tablist", { name: "Open editors" }).getByRole("tab").first().click();
    await expect(previewEditor(page)).toHaveCount(0);
    await previewTab(page).click();
    await expect(previewEditor(page)).toBeVisible();
  });

  test("the preview is saved with the project", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await openExploreCategory(page, "Effects");
    await exploreRow(page, "Reverb").click();
    await expect(previewEditor(page).locator('[data-device][aria-label="Reverb"]')).toHaveCount(1);

    await page.waitForTimeout(400); // let the debounced autosave flush
    await page.reload();
    await dismissStart(page);
    await previewTab(page).click();
    await expect(previewEditor(page).locator('[data-device][aria-label="Reverb"]')).toHaveCount(1);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the preview sheet has pads under it to play it with, and stays on Explore", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await page.getByRole("navigation", { name: "Places" }).getByRole("button", { name: "Explore", exact: true }).tap();
    await openExploreCategory(page, "Instruments");
    await page.getByRole("button", { name: "FM", exact: true }).tap();

    await expect(page.getByTestId("preview-sheet")).toBeVisible();
    // Docked under the sheet, as the Studio's keys are under its editor.
    const panel = page.getByTestId("preview-keys");
    await expect(panel.locator("[data-pitches]").first()).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Places" }).getByRole("button", { name: "Explore", exact: true }),
    ).toHaveAttribute("aria-current", "page");

    // They grow and fold as the Studio's do: a row more, then out of the way of the list.
    const rows = panel.locator("[data-pad-row]");
    await expect(rows).toHaveCount(1);
    // A disabled button takes no pointer events, so a tap on one lands on the header behind it,
    // which must not read it as a tap meant for the header.
    const fewer = panel.getByRole("button", { name: "Fewer octaves" });
    await expect(fewer).toBeDisabled();
    const box = await fewer.boundingBox();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(rows).toHaveCount(1);
    await panel.getByRole("button", { name: "More octaves" }).tap();
    await expect(rows).toHaveCount(2);
    await panel.getByRole("button", { name: "Hide the keys" }).tap();
    await expect(panel.locator("[data-pitches]")).toHaveCount(0);
    await panel.getByRole("button", { name: "Show the keys" }).tap();
    await expect(rows).toHaveCount(2);
  });
});

test.describe("phone preview rack", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("an effect tried shows as a row in the rack, comes out with its ×, and undo puts it back", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await page.getByRole("navigation", { name: "Places" }).getByRole("button", { name: "Explore", exact: true }).tap();
    await openExploreCategory(page, "Effects");
    await page.getByTestId("explore-row").getByRole("button", { name: "Reverb", exact: true }).tap();

    const rack = page.getByTestId("preview-sheet");
    const reverb = rack.locator('[data-device][aria-label="Reverb"]');
    await expect(reverb).toHaveCount(1);
    await reverb.getByRole("button", { name: /^Remove/ }).tap();
    await expect(reverb).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).first().tap();
    await expect(reverb).toHaveCount(1);
  });

  test("the preview is a sheet over Explore that minimises as the Studio's does", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await page.getByRole("navigation", { name: "Places" }).getByRole("button", { name: "Explore", exact: true }).tap();
    await openExploreCategory(page, "Effects");
    await page.getByTestId("explore-row").getByRole("button", { name: "Reverb", exact: true }).tap();

    const sheet = page.getByTestId("preview-sheet");
    await expect(sheet).toHaveAttribute("data-detent", "half");
    await sheet.getByRole("slider", { name: "Preview height" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(sheet).toHaveAttribute("data-detent", "peek");
    // Minimised: the name on its bar, and the list has the room. Tapping another effect still tries it.
    await expect(sheet.getByText("Micro VA, Reverb", { exact: true })).toBeVisible();
    await page.getByTestId("explore-row").getByRole("button", { name: "Delay", exact: true }).tap();
    await expect(sheet.getByText("Micro VA, Reverb, Delay", { exact: true })).toBeVisible();
  });

  test("New track takes the sound and what's tried on it", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await page.getByRole("navigation", { name: "Places" }).getByRole("button", { name: "Explore", exact: true }).tap();
    await openExploreCategory(page, "Effects");
    await page.getByTestId("explore-row").getByRole("button", { name: "Reverb", exact: true }).tap();
    await page.getByRole("button", { name: "New track", exact: true }).tap();

    // The phone goes to the Studio with it, as any pick does, where it's a lane of its own.
    await expect(page.getByTestId("preview-sheet")).toHaveCount(0);
    await expect(page.getByTestId("lane")).toHaveCount(2);
  });
});

test.describe("effects", () => {
  test.use({ viewport: { width: 1320, height: 900 } });

  test("tapping an effect tries it on the selected track's sound, and Use on adds just it", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await openExploreCategory(page, "Effects");
    const inPreview = previewEditor(page).locator('[data-device][aria-label="Reverb"]');

    await exploreRow(page, "Reverb").click();
    await expect(inPreview).toHaveCount(1);
    // The track's sound with the effect after it: the row says it's in the preview.
    await expect(previewEditor(page).getByTestId("preview-title")).toHaveText(/, Reverb$/);
    await expect(page.getByTestId("explore-row").filter({ hasText: "in the preview" })).toHaveCount(1);

    await pickUseOn(page, "Add just the devices");
    // The track it went on is the one shown now, with the effect on it.
    await expect(previewTab(page)).toHaveAttribute("aria-selected", "false");
    await expect(page.locator('[data-device][aria-label="Reverb"]')).toHaveCount(1);
  });

  test("an effect's + adds it to the selected track in one click, no preview", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await openExploreCategory(page, "Effects");
    await page.getByRole("button", { name: 'Add "Reverb" to the selected track' }).click();
    await expect(previewTab(page)).toHaveCount(0);
    await expect(page.locator('[data-device][aria-label="Reverb"]')).toHaveCount(1); // the device rack shows it
  });

  test("the preview's changes are in the project's history, its discarding too", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await openExploreCategory(page, "Effects");
    const devices = previewEditor(page).locator("[data-device]");

    await exploreRow(page, "Reverb").click();
    await expect(previewEditor(page).locator('[data-device][aria-label="Reverb"]')).toHaveCount(1);
    const withReverb = await devices.count();
    await exploreRow(page, "Delay").click();
    await expect(devices).toHaveCount(withReverb + 1);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(devices).toHaveCount(withReverb);

    await previewEditor(page).getByRole("button", { name: "Discard" }).click();
    await expect(previewTab(page)).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await previewTab(page).click();
    await expect(devices).toHaveCount(withReverb);
  });

  test("a MIDI device is tried on the sound too", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await openExploreCategory(page, "MIDI devices");
    const first = page.getByTestId("explore-row").first().getByRole("button").first();
    const name = (await first.getAttribute("aria-label"))!;
    await first.click();
    await expect(previewEditor(page).locator(`[data-device][aria-label="${name}"]`)).toHaveCount(1);
  });
});
