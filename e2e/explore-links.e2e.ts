import { test, expect } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Explore's ways out (COMM-2, COMM-3, COMM-4, AGENT-37): the rail's shortcuts to its pages, home's
 * buttons back to your projects, and, with no MCP client connected, the way to set one up.
 */

test.use({ viewport: { width: 1320, height: 900 } });

test("the rail's shortcuts open Explore's pages", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const rail = page.getByRole("navigation", { name: "Library views" });
  for (const label of ["Instruments", "Effects", "MIDI devices", "Patches", "Favourites", "Samples"]) {
    const shortcut = rail.getByRole("button", { name: `Explore ${label}` });
    await shortcut.click();
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(shortcut).toHaveAttribute("aria-current", "page");
  }
});

test("Explore home leads back to the open project and to the list of projects", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const links = page.getByRole("navigation", { name: "Your projects" });
  await links.getByRole("button", { name: "All projects" }).click();
  await expect(page.getByRole("list", { name: "Projects" })).toBeVisible();
  // Reached from Explore, so it offers the way back, and only then.
  await page.getByRole("button", { name: "Back to Explore" }).click();
  await expect(links).toBeVisible();
  await page.getByRole("navigation", { name: "Library views" }).getByRole("button", { name: "Project" }).click();
  await expect(page.getByRole("button", { name: "Back to Explore" })).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "Library views" })
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  await links.getByRole("button").first().click();
  await expect(
    page.getByRole("navigation", { name: "Library views" }).getByRole("button", { name: "Project" }),
  ).toHaveAttribute("aria-current", "page");
});

test("with no MCP connected, the rail and Explore both lead to the setup", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  const guide = /\/MCP\.md$/;
  await expect(page.getByRole("link", { name: "MCP not connected: how to connect an agent" })).toHaveAttribute(
    "href",
    guide,
  );
  const card = page.getByRole("region", { name: "Make your own" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: "Connect an agent over MCP" })).toHaveAttribute("href", guide);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Explore doesn't offer setting up an agent, which takes a computer", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await expect(page.getByRole("navigation", { name: "Your projects" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Make your own" })).toHaveCount(0);
  });

  test("Explore's project button opens the project's page, not the Studio", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await page.getByRole("navigation", { name: "Your projects" }).getByRole("button").first().click();
    await expect(page.getByRole("button", { name: "Back to Projects" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to Explore" })).toBeVisible();
  });
});
