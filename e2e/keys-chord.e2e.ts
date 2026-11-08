import { test, expect } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * The computer keyboard's held keys light their pads in the keys panel. They are drawn from a
 * store only the panel subscribes to, so a key press redraws the panel and not the whole desktop
 * (which staggered the notes of a chord, each key waiting on the last one's render).
 */

// Scrollbars on, as a desktop browser has them (headless hides them), so the chord rows' shows.
test.use({ viewport: { width: 1320, height: 900 }, launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("a chord's keys light together, and let go together", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const lit = page.locator('button[data-pitches][aria-pressed="true"]');
  await expect(lit).toHaveCount(0);

  for (const key of ["z", "c", "b"]) await page.keyboard.down(key);
  await expect(lit).toHaveCount(3);

  for (const key of ["z", "c", "b"]) await page.keyboard.up(key);
  await expect(lit).toHaveCount(0);
});

test("in chords mode the rows past the keyboard's four scroll into view", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const scroller = page.locator("[data-keys-scroll]");
  const gutter = () => scroller.evaluate((element) => element.offsetWidth - element.clientWidth);
  // The notes' rows never scroll, so they never show a scrollbar, however near the edge they fit.
  expect(await gutter()).toBe(0);
  await page.getByRole("button", { name: "Chords", exact: true }).click();
  await expect.poll(gutter).toBeGreaterThan(0);

  // Column-reverse, so the last row in the DOM is the top one: off a key, and scrolled out of view.
  const top = scroller.locator("[data-pitches]").last();
  await expect(top).not.toBeInViewport();
  await scroller.hover();
  await page.mouse.wheel(0, -1000);
  await expect(top).toBeInViewport();

  // A click plays it, though no key does.
  await top.dispatchEvent("pointerdown", { pointerId: 1, isPrimary: true, button: 0 });
  await expect(top).toHaveAttribute("aria-pressed", "true");
});

test("a held chord that leads to a new key offers it above, taken by letting go there (DAW-12.3)", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Chords", exact: true }).click();
  await expect(page.getByRole("button", { name: "Key and scale" })).toContainText("C major");

  // E is V of vi in C major, the doorway to A minor.
  const doorway = page.locator("[data-keys-scroll]").getByRole("button", { name: "E", exact: true }).first();
  await doorway.scrollIntoViewIfNeeded();
  const bubble = page.getByRole("button", { name: "Change key to A minor" });
  await expect(bubble).toHaveCount(0);
  const pad = (await doorway.boundingBox())!;
  await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
  await page.mouse.down();
  await expect(bubble).toBeVisible();

  // The pad holds the pointer, so the bubble is pressed by the lift, not its own click.
  const target = (await bubble.boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
  await expect(bubble).toHaveAttribute("data-over", "");
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Key and scale" })).toContainText("A minor");
  await expect(bubble).toHaveCount(0);
});

test.describe("on a Mac", () => {
  // Ctrl+Shift lifts the keys only on a Mac (elsewhere the browser keeps Ctrl+Shift+W and co).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }));
  });

  test("the Keys header's ⓘ lists the shortcuts for what the keys play", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await page.getByRole("button", { name: "Chords", exact: true }).click();
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toContainText("Chord rows 9-12");
    await expect(help).toContainText("Sustain pedal");
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
  });

  test("Shift plays chord rows 5-8, and Ctrl+Shift rows 9-12", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await page.getByRole("button", { name: "Chords", exact: true }).click();
    // Column-reverse: the DOM's rows run bottom first, so the nth child is row n+1.
    const firstPadOfRow = (row: number) =>
      page.locator("[data-keys-scroll] > div > *").nth(row).locator("[data-pitches]").first();
    const lit = page.locator('button[data-pitches][aria-pressed="true"]');

    for (const [modifiers, row] of [
      [["Shift"], 4],
      [["Control", "Shift"], 8],
    ] as const) {
      for (const modifier of modifiers) await page.keyboard.down(modifier);
      await page.keyboard.down("z");
      await expect(lit).toHaveCount(1);
      await expect(lit).toHaveAttribute("data-pitches", (await firstPadOfRow(row).getAttribute("data-pitches"))!);
      await page.keyboard.up("z");
      for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
      await expect(lit).toHaveCount(0);
    }
  });
});
