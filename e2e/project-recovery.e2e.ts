import { test, expect, type Page } from "@playwright/test";
import { createProjectFromList, dismissStart, openProjectList, openRowAction } from "./support/app";

/**
 * A project that cannot be read always has a way out (DAW-68). The dialog's rebuild is unit-tested
 * (`test/projectRecovery.test.ts`); what needs a browser is that leaving it lands somewhere else and
 * stays there, since the address names the project a boot opens and a reload used to reopen the
 * broken one.
 */

/** Two projects, "Keeper" and a fresh one left open, whose saved state is then made unreadable. */
async function breakTheOpenProject(page: Page): Promise<void> {
  await page.goto("/");
  await dismissStart(page);
  await openProjectList(page);
  page.once("dialog", (dialog) => void dialog.accept("Keeper"));
  await openRowAction(page, "Rename…");
  await expect(page).toHaveURL(/\/p\/keeper~/);
  await createProjectFromList(page);
  await expect(page).toHaveURL(/\/p\/project-\d+~/);
  const id = decodeURIComponent(page.url().split("~").pop() ?? "");
  // Not JSON at all: the keyframe a boot reads first.
  await page.evaluate(async (projectId) => {
    const root = await navigator.storage.getDirectory();
    const projects = await root.getDirectoryHandle("projects");
    const bundle = await projects.getDirectoryHandle(projectId);
    const file = await bundle.getFileHandle("project.json", { create: true });
    const writable = await file.createWritable();
    await writable.write("{ not a project");
    await writable.close();
  }, id);
  await page.reload();
  await expect(page.getByRole("dialog", { name: "This project needs rebuilding" })).toBeVisible();
}

test("a project that cannot be read offers the others, and opening one stays opened", async ({ page }) => {
  await breakTheOpenProject(page);
  await page.getByRole("button", { name: "Keeper", exact: true }).click();
  await expect(page).toHaveURL(/\/p\/keeper~/);
  await dismissStart(page);
  await expect(page.getByRole("dialog", { name: /This project/ })).toHaveCount(0);

  // The loop: a reload must not land back on the broken project.
  await page.reload();
  await dismissStart(page);
  await expect(page).toHaveURL(/\/p\/keeper~/);
  await expect(page.getByRole("dialog", { name: /This project/ })).toHaveCount(0);
});

test("a new project can be started without trying the rebuild first", async ({ page }) => {
  await breakTheOpenProject(page);
  await page.getByRole("button", { name: "Start a new project" }).click();
  await expect(page).toHaveURL(/\/p\/project-\d+-recovered~/);
  await dismissStart(page);
  await expect(page.getByRole("dialog", { name: /This project/ })).toHaveCount(0);
});
