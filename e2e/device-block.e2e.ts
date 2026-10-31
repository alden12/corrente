import { test, expect, type Page } from "@playwright/test";
import { dismissStart, openExploreCategory } from "./support/app";

/**
 * Devices in the rack fold (DAW-61.3). A device with sections starts open with them folded, so a big
 * instrument shows its section names; one without starts folded, to a narrow column with its name
 * running down it. Folding is how you're looking, so it outlives a reload.
 */

test.use({ viewport: { width: 1500, height: 1000 } });

const block = (page: Page, name: string) => page.locator(`[role="group"][aria-label="${name}"][data-open]`);

test("devices and their sections start folded as far as they go, and what you open is kept", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openExploreCategory(page, "Effects");
  await page.getByRole("button", { name: 'Add "Reverb" to the selected track' }).click();

  // The Reverb has no sections to fold to, so it starts folded: a column, its name running down it,
  // with no graph button (that's for a device you're looking into).
  const reverb = block(page, "Reverb");
  await expect(reverb).toHaveAttribute("data-open", "false");
  await expect(reverb.getByText("Decay", { exact: true })).toHaveCount(0);
  await expect(reverb.getByRole("button", { name: "View Reverb's graph" })).toHaveCount(0);
  const folded = (await reverb.boundingBox())!;
  expect(folded.height).toBeGreaterThan(folded.width);
  // Every folded device is the same height, however long its name.
  await page.getByRole("button", { name: 'Add "Ping-Pong Delay" to the selected track' }).click();
  const longer = (await block(page, "Ping-Pong Delay").boundingBox())!;
  expect(longer.height).toBe(folded.height);

  // Its bypass is a switch that says what it does.
  const bypass = reverb.getByRole("button", { name: "Bypass Reverb" });
  await expect(bypass).toHaveAttribute("aria-pressed", "true");
  await bypass.click();
  await expect(reverb.getByRole("button", { name: "Enable Reverb" })).toHaveAttribute("aria-pressed", "false");

  // The Micro VA starts open, its sections folded; one opens on its own.
  const instrument = block(page, "Micro VA");
  await expect(instrument).toHaveAttribute("data-open", "true");
  const filterEnv = instrument.getByRole("button", { name: "Filter Env", exact: true });
  await expect(filterEnv).toHaveAttribute("aria-expanded", "false");
  await filterEnv.click();
  await expect(instrument.getByRole("group", { name: "Filter Env" }).getByText("Filter Attack")).toBeVisible();
  // Open, it's the same height as the folded ones beside it, so the row lines up.
  expect((await instrument.boundingBox())!.height).toBe(folded.height);
  await expect(instrument.getByRole("button", { name: "Amp Env", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await reverb.getByRole("button", { name: "Unfold Reverb" }).click();
  await expect(reverb.getByText("Decay", { exact: true })).toBeVisible();
  await expect(reverb.getByRole("button", { name: "View Reverb's graph" })).toBeVisible();

  await page.waitForTimeout(600); // past the project's 300ms save tick, so the reverb is saved
  await page.reload();
  await dismissStart(page);
  await expect(block(page, "Reverb")).toHaveAttribute("data-open", "true");
  await expect(block(page, "Micro VA").getByRole("button", { name: "Filter Env", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  await block(page, "Reverb").getByRole("button", { name: "Fold Reverb" }).click();
  await expect(block(page, "Reverb").getByText("Decay", { exact: true })).toHaveCount(0);
});
