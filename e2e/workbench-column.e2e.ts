import { test, expect, type Page } from "@playwright/test";
import { dismissStart, openExploreCategory } from "./support/app";

/**
 * The workbench is one scrolling column (DAW-61.1): the clips line, the roll, then the devices
 * under their bar, which jumps to any device and, once the roll has scrolled away, back to it.
 */

test.use({ viewport: { width: 1320, height: 800 } });

const devicesBar = (page: Page) => page.getByRole("region", { name: "Devices" });

async function addEffect(page: Page, name: string) {
  await openExploreCategory(page, "Effects");
  await page.getByRole("button", { name, exact: true }).first().click();
  await page
    .getByRole("region", { name })
    .getByRole("button", { name: /^Add to / })
    .click();
}

test("the devices' bar jumps to a device, and back to the roll once it has scrolled away", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  for (const name of ["Reverb", "Tape Echo", "Tremolo"]) await addEffect(page, name);

  const returnToRoll = page.getByRole("button", { name: /^Roll/ });
  await expect(returnToRoll).toHaveCount(0); // the roll is on screen

  // The devices' bar jumps to a device from the top, roll and all.
  await devicesBar(page).getByRole("button", { name: "Tremolo", exact: true }).click();
  await expect(page.locator('[data-device][aria-label="Tremolo"]')).toBeInViewport();
  await page.getByTestId("roll-scroll").evaluate((element) => element.closest(".overflow-y-auto")?.scrollTo(0, 0));

  // Jumping to the last device scrolls the roll off the top, and the bar takes its place.
  await page.locator('[data-device][aria-label="Tremolo"]').scrollIntoViewIfNeeded();
  await expect(returnToRoll).toBeVisible();
  await expect(returnToRoll).toContainText("Clip 1"); // it names the clip open in the roll

  // A device's chip scrolls to it.
  await devicesBar(page).getByRole("button", { name: "Micro VA", exact: true }).click();
  await expect(page.locator('[data-device][aria-label="Micro VA"]')).toBeInViewport();

  await returnToRoll.click();
  await expect(page.getByTestId("roll-scroll")).toBeInViewport();
  await expect(returnToRoll).toHaveCount(0);
});

test("the devices fold away under their bar, and a jump opens them again", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Fold the devices" }).click();
  await expect(page.locator('[data-device][aria-label="Micro VA"]')).toHaveCount(0);
  await devicesBar(page).getByRole("button", { name: "Micro VA", exact: true }).click();
  await expect(page.locator('[data-device][aria-label="Micro VA"]')).toBeInViewport();
});

test("the devices' menu folds every device, and opens them all again", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await addEffect(page, "Reverb");
  const blocks = page.locator("[data-device]");
  await page.getByRole("button", { name: "Device chain actions" }).click();
  await page.getByRole("menuitem", { name: "Fold all devices" }).click();
  await expect(blocks.and(page.locator('[data-open="true"]'))).toHaveCount(0);
  await page.getByRole("button", { name: "Device chain actions" }).click();
  await page.getByRole("menuitem", { name: "Open all devices" }).click();
  await expect(blocks.and(page.locator('[data-open="false"]'))).toHaveCount(0);
});

test("the roll folds away under its toolbar, keeping the keys and a glance at its notes", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const roll = (await page.getByTestId("roll-scroll").boundingBox())!;
  await page.mouse.click(roll.x + 120, roll.y + 60);
  await expect(page.getByTestId("note")).toHaveCount(1);
  await page.getByRole("button", { name: "Fold the piano roll" }).click();
  await expect(page.getByTestId("roll-scroll")).toBeHidden();
  // Folded, the header shows a glance at the clip's notes in the room the grid left.
  await expect(page.getByRole("img", { name: "Clip Clip 1, 1 notes" }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Fold the keys" })).toBeVisible();
  await page.getByRole("button", { name: "Open the piano roll" }).click();
  await expect(page.getByTestId("roll-scroll")).toBeVisible();
});

test("the wheel over the keys scrolls the column once the keys have nothing to scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 700 });
  await page.goto("/");
  await dismissStart(page);
  const column = page.getByTestId("workbench-column");
  const key = (await page.getByRole("button", { name: /^Q/ }).first().boundingBox())!;
  await page.mouse.move(key.x + 10, key.y + 10);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("the clips line opens into every clip, and folds back to one line", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const toggle = page.getByRole("button", { name: "Open the clips" });
  await toggle.click();
  await expect(page.getByRole("button", { name: "Fold the clips" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Fold the clips" }).click();
  await expect(page.getByRole("button", { name: "Open the clips" })).toHaveAttribute("aria-expanded", "false");
});

test("clips are deleted in a delete mode of the open clips, not from a small × on every chip", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Add a new empty clip" }).click();
  const removes = page.getByRole("button", { name: /^Remove / });
  // Folded to a line, no chip can be deleted by a stray tap.
  await expect(removes).toHaveCount(0);

  await page.getByRole("button", { name: "Open the clips" }).click();
  await expect(removes).toHaveCount(0);
  await page.getByRole("button", { name: "Delete clips" }).click();
  await expect(removes).toHaveCount(2);
  await removes.last().click();
  await expect(removes).toHaveCount(0);
  // The last clip clears rather than goes, and still says so.
  await expect(page.getByRole("button", { name: /^Clear / })).toHaveCount(1);

  // Folding the clips ends the mode.
  await page.getByRole("button", { name: "Fold the clips" }).click();
  await page.getByRole("button", { name: "Open the clips" }).click();
  await expect(page.getByRole("button", { name: "Delete clips" })).toHaveAttribute("aria-pressed", "false");
});

test("a tap anywhere on a section's header that is not a control folds it", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  // The title folds the roll, as the arrow does.
  await page.getByText("Piano roll", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Open the piano roll" })).toHaveAttribute("aria-expanded", "false");
  await page.getByText("Piano roll", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Fold the piano roll" })).toHaveAttribute("aria-expanded", "true");

  // A control in the header does its own thing and folds nothing: the + adds a clip.
  await page.getByRole("button", { name: "Add a new empty clip" }).click();
  await expect(page.getByRole("button", { name: "Open the clips" })).toHaveAttribute("aria-expanded", "false");

  // A device's header folds its device the same way.
  const device = page.locator("[data-device][role=group]").first();
  await device
    .locator("> div")
    .first()
    .click({ position: { x: 200, y: 10 } });
  await expect(device).toHaveAttribute("data-open", "false");
});

test("the clips header folds from its empty space past the chips, but not from just beside them", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const clips = page.getByRole("region", { name: "Clips" });
  const header = clips.locator("> div").first();
  const strip = (await header.locator("[data-no-fold]").first().boundingBox())!;
  const add = (await page.getByRole("button", { name: "Add a new empty clip" }).boundingBox())!;
  const middle = strip.y + strip.height / 2;

  // Just past the last chip is still the strip's: nothing folds.
  await page.mouse.click(strip.x + strip.width - 4, middle);
  await expect(page.getByRole("button", { name: "Open the clips" })).toHaveAttribute("aria-expanded", "false");

  // The empty space between the chips and the buttons opens the clips.
  await page.mouse.click((strip.x + strip.width + add.x) / 2, middle);
  await expect(page.getByRole("button", { name: "Fold the clips" })).toHaveAttribute("aria-expanded", "true");
});
