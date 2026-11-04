import { test, expect } from "@playwright/test";
import { dismissStart, openStudio, openExploreCategory, phoneEditorOpen, swapFromExplore } from "./support/app";

/**
 * The drum machine: a Drum Kit track can be edited either as a pad x step grid ("Pads")
 * or as the drum-labelled piano roll ("Keys", the default). Both write into the same
 * note-clip model, so patterns are just notes. Rows are the kit's loaded pads (the
 * built-in CC0 kit by default).
 */

test.use({ viewport: { width: 1320, height: 900 } });

test("a Drum Kit track shows the step grid; toggling a cell writes a note", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Applying Simple House Kit (from Explore's Instruments) to the (selected) seed track
  // loads the built-in pads. Switch the editor to Pads to get the step grid.
  await openExploreCategory(page, "Instruments");
  await swapFromExplore(page, "Simple House Kit");
  await expect(page.getByRole("tablist").getByTitle("Simple House Kit", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Pads", exact: true }).click();

  // A pad row for the built-in Kick, with its step cells.
  const kickStep1 = page.getByRole("button", { name: "Kick step 1", exact: true });
  await expect(kickStep1).toBeVisible();
  await expect(kickStep1).toHaveAttribute("aria-pressed", "false");

  // Toggling the cell places a hit (a note); toggling again clears it.
  await kickStep1.click();
  await expect(kickStep1).toHaveAttribute("aria-pressed", "true");
  await kickStep1.click();
  await expect(kickStep1).toHaveAttribute("aria-pressed", "false");
});

test("a Drum Kit track can switch to the piano roll (Keys), editing the same clip", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await openExploreCategory(page, "Instruments");
  await swapFromExplore(page, "Simple House Kit");

  // Place a kick hit in the step grid (writes a note into the clip).
  await page.getByRole("radio", { name: "Pads", exact: true }).click();
  await page.getByRole("button", { name: "Kick step 1", exact: true }).click();

  // Switch the editor to Keys: the step grid is replaced by the piano roll, and the
  // hit we placed shows up as a note there (same clip, different surface).
  await page.getByRole("radio", { name: "Keys", exact: true }).click();
  const grid = page.getByTestId("piano-grid");
  await expect(grid).toBeVisible();
  await expect(page.getByTestId("note")).toHaveCount(1);
  // The reserved left gutter (a column beside the notes, not over them) labels the row
  // with its assigned note + drum name ("C2 Kick" - GM kick is MIDI 36, which the C4 = 60
  // octave numbering displays as C2), so you can see and play the mapping.
  await expect(page.getByText("C2 Kick", { exact: true })).toBeVisible();
  // The desktop keys panel sits under it, as under any other roll.
  await expect(page.getByRole("slider", { name: "Velocity", exact: true })).toBeVisible();

  // Back to Pads: the step grid returns with the hit still lit.
  await page.getByRole("radio", { name: "Pads", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kick step 1", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("on a phone the drum roll gets the touch treatment, like any other roll (MOBILE-18)", async ({ page }) => {
  await phoneEditorOpen(page);
  await page.goto("/");
  await dismissStart(page);

  await openExploreCategory(page, "Instruments");
  await swapFromExplore(page, "Simple House Kit");
  await page.getByRole("radio", { name: "Keys", exact: true }).click();
  await expect(page.getByTestId("piano-grid")).toBeVisible();

  // The velocity lane is the visible half of the desktop treatment (the other is the toolbar),
  // and its resize separator is the stable handle on it.
  const velocityLane = page.getByRole("separator", { name: "Resize velocity lane" });
  await expect(velocityLane).toBeVisible();

  // Narrow to a phone: `compact` reaches the roll through DrumRoll, so the lane closes. It used
  // not to, because DrumRoll took no `compact` prop at all and the editor only handed one to the
  // pitched roll - a drum track kept the desktop layout on a 390px screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page); // the touch shell starts on Explore
  await expect(page.getByTestId("piano-grid")).toBeVisible();
  await expect(velocityLane).toBeHidden();
});

test("on the desktop, a Drum Kit track's keys are its pads, in order from Z", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openExploreCategory(page, "Instruments");
  await swapFromExplore(page, "Simple House Kit");
  await expect(page.getByRole("tablist").getByTitle("Simple House Kit", { exact: true })).toBeVisible();

  // The kit's first pad (the built-in Kick, on GM note 36) is on Z, and the key lights while held.
  const kick = page.getByRole("button", { name: "Kick (C2)", exact: true });
  await expect(kick).toBeVisible();
  await page.keyboard.down("z");
  await expect(kick).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up("z");
  await expect(kick).toHaveAttribute("aria-pressed", "false");
  // No key, range or chords to set for a kit.
  await expect(page.getByRole("button", { name: "Chords", exact: true })).toHaveCount(0);
});

test("the kit's own picker swaps the whole kit in one undoable edit", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openExploreCategory(page, "Instruments");
  await swapFromExplore(page, "Simple House Kit");
  await expect(page.getByRole("button", { name: "Kick (C2)", exact: true })).toBeVisible();

  // Every pad instrument is offered, and picking one brings its own sounds, not the last kit's.
  const kit = page.getByRole("combobox", { name: "Kit" });
  await expect(kit.getByRole("option")).toHaveText(["Acoustic Kit", "Simple House Kit", "808 Kit"]);
  await kit.selectOption({ label: "808 Kit" });
  await expect(page.getByRole("button", { name: "808 Kick (C2)", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(kit).toHaveValue("drumkit");
  await expect(page.getByRole("button", { name: "Kick (C2)", exact: true })).toBeVisible();
});
