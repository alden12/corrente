import { test, expect } from "@playwright/test";
import { createProjectFromList, dismissStart, openProjectList } from "./support/app";

/**
 * A project whose own name missed its rename (HOST-24 sent renames to the wrong project) opened as
 * "Untitled", though the list knew its name (DAW-90). Opening it now takes the listed name back.
 */
test("a project the list knows by name opens with that name, not Untitled", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjectList(page);
  // The first project is Untitled too, so wait for the address to leave it, not for a name.
  await expect(page).toHaveURL(/\/p\/untitled~/);
  const first = page.url();
  await createProjectFromList(page);
  await expect(page).not.toHaveURL(first);
  await expect(page).toHaveURL(/\/p\/untitled~/);
  const id = decodeURIComponent(page.url().split("~").pop() ?? "");

  // The rename that reached only the list: meta.json names it, project.json still says Untitled.
  // Written from a static page, since the app rewrites meta.json as it unloads.
  await page.goto("/favicon.svg");
  await page.evaluate(async (projectId) => {
    const root = await navigator.storage.getDirectory();
    const bundle = await (await root.getDirectoryHandle("projects")).getDirectoryHandle(projectId);
    const writable = await (await bundle.getFileHandle("meta.json", { create: true })).createWritable();
    await writable.write(JSON.stringify({ name: "Euclidean", modifiedAt: new Date().toISOString() }));
    await writable.close();
  }, id);

  await page.goto("/");
  await dismissStart(page);
  // The address names the project by its own name, which is now the listed one.
  await expect(page).toHaveURL(new RegExp(`/p/euclidean~${id}`));
  // It stays: a reload reads it back from the project itself.
  await page.reload();
  await dismissStart(page);
  await expect(page).toHaveURL(new RegExp(`/p/euclidean~${id}`));
});
