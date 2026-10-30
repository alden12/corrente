import { test, expect, type Page } from "@playwright/test";
import { dismissStart, openExploreCategory, phoneEditorOpen } from "./support/app";

/**
 * A chain's devices are reordered by dragging their handle (DAW-61.3), with a mouse or a finger, or
 * moved a place at a time with its arrow keys.
 */

test.use({ viewport: { width: 1500, height: 1000 } });

const effectOrder = (page: Page) =>
  page
    .locator("[data-device][data-open]")
    .evaluateAll((all) => all.map((each) => each.getAttribute("aria-label")).filter((name) => name !== "Micro VA"));

async function addEffects(page: Page, names: string[]) {
  await openExploreCategory(page, "Effects");
  for (const name of names) await page.getByRole("button", { name: `Add "${name}" to the selected track` }).click();
}

/** Drag `name`'s handle to just past the left edge of `onto`. */
async function dragBefore(page: Page, name: string, onto: string) {
  const handle = page.getByRole("button", { name: `Move ${name}` });
  const from = (await handle.boundingBox())!;
  const target = (await page.locator(`[data-device][aria-label="${onto}"]`).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 4, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("an effect dragged by its handle lands where it's dropped", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await addEffects(page, ["Reverb", "Tape Echo", "Tremolo"]);
  await expect.poll(() => effectOrder(page)).toEqual(["Reverb", "Tape Echo", "Tremolo"]);

  await dragBefore(page, "Tremolo", "Reverb");
  await expect.poll(() => effectOrder(page)).toEqual(["Tremolo", "Reverb", "Tape Echo"]);

  // The arrow keys move it a place at a time.
  await page.getByRole("button", { name: "Move Tremolo" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => effectOrder(page)).toEqual(["Reverb", "Tremolo", "Tape Echo"]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.beforeEach(({ page }) => phoneEditorOpen(page));

  test("devices stack across the screen, folded ones as rows, and sections as rows too", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await addEffects(page, ["Reverb"]);
    await page.getByRole("navigation", { name: "Places" }).getByRole("button", { name: "Studio", exact: true }).click();

    const reverb = page.locator('[data-device][aria-label="Reverb"]');
    await reverb.scrollIntoViewIfNeeded();
    const folded = (await reverb.boundingBox())!;
    expect(folded.width).toBeGreaterThan(folded.height); // a row, not a column
    expect(folded.width).toBeGreaterThan(300); // across the screen

    // The Micro VA's folded sections are rows one under another.
    const microVa = page.locator('[data-device][aria-label="Micro VA"]');
    const first = (await microVa.getByRole("button", { name: "Filter", exact: true }).boundingBox())!;
    const second = (await microVa.getByRole("button", { name: "Filter Env", exact: true }).boundingBox())!;
    expect(second.y).toBeGreaterThan(first.y);
    expect(first.width).toBeGreaterThan(first.height);
  });
});
