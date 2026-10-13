import { test, expect, type Page } from "@playwright/test";
import { dismissStart, openExploreCategory } from "./support/app";

/**
 * Recently used on Explore home (COMM-1.9.7): what you took into the project, newest first. Trying
 * a sound is not taking it; adding it, or picking an effect, is.
 */

test.use({ viewport: { width: 1320, height: 900 } });

const shelf = (page: Page) => page.getByRole("region", { name: "Recently used" });

async function home(page: Page): Promise<void> {
  const back = page.getByRole("button", { name: "Back to Explore" });
  if (await back.isVisible()) await back.click();
}

test("what you take from Explore lands on the Recently used shelf, newest first", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await expect(shelf(page)).toHaveCount(0); // nothing taken yet, so no empty shelf

  // Trying FM is not using it ...
  await openExploreCategory(page, "Instruments");
  await page.getByRole("button", { name: "FM", exact: true }).click();
  await home(page);
  await expect(shelf(page)).toHaveCount(0);

  // ... adding it is.
  await openExploreCategory(page, "Instruments");
  await page.getByRole("button", { name: "FM", exact: true }).click();
  await page.getByRole("region", { name: "Trying FM" }).getByRole("button", { name: "Add as a new track" }).click();
  // An added effect counts too, and goes in front.
  await openExploreCategory(page, "Effects");
  await page.getByRole("button", { name: "Reverb", exact: true }).click();
  await page
    .getByRole("region", { name: "Reverb" })
    .getByRole("button", { name: /^Add to / })
    .click();

  await home(page);
  const cards = shelf(page).getByRole("list").getByRole("button");
  await expect(cards).toHaveText(["Reverb", "FM"].map((name) => new RegExp(name)));

  // It is kept across a reload, and a card does what the row does: FM opens in the try panel.
  await page.reload();
  await dismissStart(page);
  await home(page);
  await shelf(page).getByRole("button", { name: "FM", exact: true }).click();
  await expect(page.getByRole("region", { name: "Trying FM" })).toBeVisible();
});

test("hearted sounds get a Favourites shelf, newest first", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const favourites = page.getByRole("region", { name: "Favourites" });
  await expect(favourites).toHaveCount(0);

  await openExploreCategory(page, "Instruments");
  await page.getByRole("button", { name: 'Add "FM" to favourites' }).click();
  await openExploreCategory(page, "Effects");
  await page.getByRole("button", { name: 'Add "Reverb" to favourites' }).click();
  await home(page);

  await expect(favourites.getByRole("list").getByRole("button")).toHaveText([/Reverb/, /FM/]);
});

test("on desktop a full shelf pages with arrows, since a mouse wheel cannot scroll it sideways", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "corrente:recent:v1:local",
      JSON.stringify([
        "instrument:fm",
        "instrument:drumkit",
        "effect:reverb",
        "instrument:nimbus",
        "instrument:subtractive",
      ]),
    ),
  );
  await page.goto("/");
  await dismissStart(page);
  const back = shelf(page).getByRole("button", { name: "Back through Recently used" });
  const more = shelf(page).getByRole("button", { name: "More Recently used" });
  await expect(back).toBeDisabled(); // at the start, nothing further back
  await more.click();
  await expect(back).toBeEnabled();
});
