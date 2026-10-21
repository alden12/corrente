/**
 * Export / import a project as a portable `.daw.zip` - a plain zip of the readable bundle
 * (pretty-printed project.json + edits.json + real samples/*.wav; see `projectRepository.ts`).
 * Unzip it with any tool to inspect it. This is the same folder shape the disk-folder backend
 * (HOST-23.2.1.3) will write uncompressed, so export and on-disk are one format. An export is a
 * version in the project's history, named for it; opening one works out what it is to the projects
 * here (`planImport`).
 */
import { zipSync, unzipSync } from "fflate";
import { currentProjectId, getRepository, readExport, type BundleFiles } from "../audio/projectRepository";
import { readProjectBundle, type ProjectDeps } from "../audio/projects/operations";
import { exportFileName, versionHash } from "../audio/projects/projectVersions";
import { libraryBackup, libraryBackupFileName, readLibraryBackup, restoreLibrary } from "../audio/library/backup";
import { readFavourites, toggleFavourite } from "./explore/favourites/store";

/** Hand the browser a file to save as `name`. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Download a project as `<name>-<date>-<version>.daw.zip`. The open one comes from the live stores,
 * so it carries edits not yet saved; any other is read from where it is stored.
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
  const { log, project } = readExport(files);
  const zipped = new Blob([zipSync(files, { level: 6 })], { type: "application/zip" });
  download(zipped, exportFileName(name, new Date(), await versionHash(log, project)));
}

/** Download the library and favourites (HOST-23.2.1.2): `corrente-library-<date>.json`. */
export function downloadLibraryBackup(): void {
  const now = new Date();
  const backup = libraryBackup(readFavourites().refs, now);
  download(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), libraryBackupFileName(now));
}

/** Restore a library backup file, favourites included. */
export async function restoreLibraryFile(file: File) {
  const backup = readLibraryBackup(await file.text());
  return restoreLibrary(backup, {
    has: (ref) => readFavourites().refs.includes(ref),
    add: toggleFavourite,
  });
}

/** A `.daw.zip`'s files, unzipped. */
export const readProjectFile = async (file: File): Promise<BundleFiles> =>
  unzipSync(new Uint8Array(await file.arrayBuffer()));
