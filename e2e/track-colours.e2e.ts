import { test, expect } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Track and clip colours (DAW-47): a clip takes its track's colour, can have one of its own from its
 * menu, and goes back to its track's; and the roll names its notes (DAW-28).
 */

test.use({ viewport: { width: 1500, height: 1000 } });

const edgeOf = (locator: ReturnType<import("@playwright/test").Page["getByTestId"]>) =>
  locator.evaluate((element) => getComputedStyle(element).borderTopColor);

test("a clip takes its track's colour, a colour of its own, and its track's again", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const block = page.getByTestId("placement").first();
  const trackColour = await edgeOf(block);

  const pick = async (name: string) => {
    await block.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Colour" }).click();
    await page.getByRole("menuitemradio", { name }).click();
  };
  await pick("Pink");
  await expect.poll(() => edgeOf(block)).not.toBe(trackColour);

  await pick("Track's colour");
  await expect.poll(() => edgeOf(block)).toBe(trackColour);

  // Recolouring the track recolours its clip.
  await page.getByRole("button", { name: "Track actions" }).first().click();
  await page.getByRole("menuitem", { name: "Colour" }).click();
  await page.getByRole("menuitemradio", { name: "Lime" }).click();
  await expect.poll(() => edgeOf(block)).not.toBe(trackColour);
});

test("a note in the roll shows its name", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const roll = (await page.getByTestId("roll-scroll").boundingBox())!;
  await page.mouse.click(roll.x + 120, roll.y + 60);
  const note = page.getByTestId("note");
  await expect(note).toHaveCount(1);
  await expect(note).toHaveText(/^[A-G]#?-?\d$/);
});
