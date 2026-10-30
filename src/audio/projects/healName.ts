/**
 * A project that opens still called "Untitled" while somewhere else knows its real name (DAW-90): a
 * rename that reached the project list (its server row, or `meta.json`) but missed the project's own
 * log, as HOST-24's misrouted renames did. The project shows its own name, so it read "Untitled" as soon
 * as it opened. This takes the known name back, as a `renameProject` edit, so it reaches the log, the
 * server and undo like any rename: the caller runs it once the project's session is listening.
 *
 * Only from the default: when both names are real, there is no telling which is newer, and the
 * project's own is what its log says.
 */
import type { EditLog } from "../commands/editLog";
import type { ProjectStore } from "../project/projectStore";

const UNTITLED = "Untitled";

export function healProjectName(
  project: Pick<ProjectStore, "name">,
  editLog: Pick<EditLog, "dispatch">,
  /** The names the project is known by elsewhere, most trusted first: the list's, then `meta.json`'s. */
  known: readonly (string | undefined)[],
): void {
  if (project.name !== UNTITLED) return;
  const name = known.map((each) => each?.trim()).find((each) => each && each !== UNTITLED);
  if (name) editLog.dispatch({ type: "renameProject", name });
}
