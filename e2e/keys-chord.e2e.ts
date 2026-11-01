import { test, expect } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * The computer keyboard's held keys light their pads in the keys panel. They are drawn from a
 * store only the panel subscribes to, so a key press redraws the panel and not the whole desktop
 * (which staggered the notes of a chord, each key waiting on the last one's render).
 */

test.use({ viewport: { width: 1320, height: 900 } });

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

test("in chords mode the rows past the keyboard's four scroll into view, on a rail you can drag", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Chords", exact: true }).click();

  const scroller = page.locator("[data-keys-scroll]");
  // Column-reverse, so the last row in the DOM is the top one: off a key, and scrolled out of view.
  const top = scroller.locator("[data-pitches]").last();
  await expect(top).not.toBeInViewport();
  const rail = page.locator("[data-scroll-rail]");
  await expect(rail).toBeVisible();
  const box = (await rail.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 2);
  await expect(top).toBeInViewport();

  // A click plays it, though no key does.
  await top.dispatchEvent("pointerdown", { pointerId: 1, isPrimary: true, button: 0 });
  await expect(top).toHaveAttribute("aria-pressed", "true");
});
