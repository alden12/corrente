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
