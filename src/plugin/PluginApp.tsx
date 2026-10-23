/**
 * The plugin's window (PLUGIN-3.2): the device rack for the plugin's one track, as the app shows it,
 * filling the window. No transport, timeline or engine here: the plugin makes the sound, and
 * `PluginDevice` tells it what to play.
 */
import { applyEdit } from "../audio/commands/applyEdit";
import type { Dispatch } from "../audio/commands/types";
import type { ProjectStore } from "../audio/project/projectStore";
import { useProject } from "../audio/project/useProject";
import { DeviceRack } from "../ui/workbench/DeviceRack";

export function PluginApp({ project }: { project: ProjectStore }) {
  useProject(project);
  const track = project.getTracks()[0];
  // Edits apply straight to the project: nothing here is shared, versioned or undone yet.
  const dispatch: Dispatch = (command, author = "you") => applyEdit(project, command, author);
  return (
    <div className="h-screen overflow-y-auto bg-ground text-ink">
      {track ? (
        <DeviceRack
          track={track}
          samples={project.getSamples()}
          dispatch={dispatch}
          projectStore={project}
          midiDevices={false}
          bare
        />
      ) : (
        <p className="p-4 text-muted">No track to show.</p>
      )}
    </div>
  );
}
