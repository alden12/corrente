/**
 * The song's key for the pads and the computer keyboard (DAW-12): the project's, read live, and set
 * by dispatching an edit, so a change is undoable, saved with the song, and synced.
 */
import type { Dispatch } from "../../audio/commands/types";
import type { ProjectStore } from "../../audio/project/projectStore";
import { useProject } from "../../audio/project/useProject";
import type { SongKey } from "./padSettings";

export function useSongKey(projectStore: ProjectStore, dispatch: Dispatch): SongKey {
  const { key } = useProject(projectStore);
  return { key, setKey: ({ tonic, scale }) => dispatch({ type: "setKey", tonic, scale }) };
}
