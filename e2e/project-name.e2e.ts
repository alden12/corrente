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
  await expect(page).toHaveURL(/\/p\/project-\d+~/);
  const first = page.url();
  await createProjectFromList(page);
  await expect(page).not.toHaveURL(first);
  const id = decodeURIComponent(page.url().split("~").pop() ?? "");

  // The rename that reached only the list: meta.json names it, project.json still says Untitled (as
  // projects made before new ones were numbered did). Written from a static page, since the app
  // rewrites meta.json as it unloads.
  await page.goto("/favicon.svg");
  await page.evaluate(async (projectId) => {
    const root = await navigator.storage.getDirectory();
    const bundle = await (await root.getDirectoryHandle("projects")).getDirectoryHandle(projectId);
    const write = async (path: string, text: string) => {
      const writable = await (await bundle.getFileHandle(path, { create: true })).createWritable();
      await writable.write(text);
      await writable.close();
    };
    const project = JSON.parse(await (await (await bundle.getFileHandle("project.json")).getFile()).text());
    await write("project.json", JSON.stringify({ ...project, name: "Untitled" }));
    await write("meta.json", JSON.stringify({ name: "Euclidean", modifiedAt: new Date().toISOString() }));
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
