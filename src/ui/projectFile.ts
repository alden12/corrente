/**
 * Export / import a project as a portable `.daw.zip` - a plain zip of the readable bundle
 * (pretty-printed project.json + edits.json + real samples/*.wav; see `projectRepository.ts`).
 * Unzip it with any tool to inspect it. This is the same folder shape the disk-folder backend
 * (15D) will write uncompressed, so export and on-disk are one format. Import makes a new project.
 */
import { zipSync, unzipSync } from "fflate";
import { currentProjectId, getRepository } from "../audio/projectRepository";
import { importProject, readProjectBundle, type ProjectDeps } from "../audio/projects/operations";

/** `Deep House Jam` -> `deep-house-jam`, for a file name any system accepts. */
const fileStem = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "project";

/**
 * Download a project as `<name>.daw.zip`. The open one comes from the live stores, so it carries
 * edits not yet saved; any other is read from where it is stored.
 */
export async function exportProjectFile(
  projectId: string,
  name: string,
  { projectStore, editLog }: Pick<ProjectDeps, "projectStore" | "editLog">,
): Promise<void> {
  const files =
    projectId === currentProjectId()
      ? await getRepository().exportBundle(projectStore.snapshot(), editLog.getEntries(), editLog.getNotes())
      : await readProjectBundle(projectId);
  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileStem(name)}.daw.zip`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Open a `.daw.zip` as a new project and switch to it. */
export async function importProjectFile(file: File, deps: ProjectDeps): Promise<void> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  await importProject(deps, files);
}
