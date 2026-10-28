/**
 * The plugin's window (PLUGIN-3.2): Explore down the left (PLUGIN-3.5), and the device rack for the
 * plugin's one track, as the app shows it, filling the rest, under the host's 16 macros (PLUGIN-3.4),
 * which a knob's right-click menu maps. No transport, timeline or engine here: the plugin makes the
 * sound, and `PluginDevice` tells it what to play.
 */
import { applyEdit } from "../audio/commands/applyEdit";
import type { Dispatch } from "../audio/commands/types";
import type { SoundPreview } from "../audio/live/preview";
import type { ProjectStore } from "../audio/project/projectStore";
import { useProject } from "../audio/project/useProject";
import { DeviceRack } from "../ui/workbench/DeviceRack";
import { KnobExtrasProvider } from "../ui/knobExtras";
import { MacroStrip } from "./MacroStrip";
import type { PluginDevice } from "./pluginDevice";
import { PluginExplore } from "./PluginExplore";
import type { PluginMacros } from "./pluginMacros";
import { useMacros } from "./useMacros";

export function PluginApp({
  project,
  preview,
  device,
  macros,
}: {
  project: ProjectStore;
  preview: SoundPreview;
  device: PluginDevice;
  macros: PluginMacros;
}) {
  useProject(project);
  const macroView = useMacros(device, macros);
  const track = project.getTracks()[0];
  // Edits apply straight to the project: nothing here is shared, versioned or undone yet.
  const dispatch: Dispatch = (command, author = "you") => applyEdit(project, command, author);
  return (
    <div className="h-screen flex bg-ground text-ink">
      <PluginExplore project={project} dispatch={dispatch} preview={preview} />
      <div className="flex-1 min-w-0 overflow-y-auto">
        <MacroStrip view={macroView} />
        {track ? (
          <KnobExtrasProvider value={macroView.extras}>
            <DeviceRack
              track={track}
              samples={project.getSamples()}
              dispatch={dispatch}
              projectStore={project}
              midiDevices={false}
              bare
            />
          </KnobExtrasProvider>
        ) : (
          <p className="p-4 text-muted">No track to show.</p>
        )}
      </div>
    </div>
  );
}
