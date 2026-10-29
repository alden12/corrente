/**
 * The plugin's window, laid out like the app's desktop (PLUGIN-3.12): the activity rail and the
 * panel it has open (Explore, PLUGIN-3.5) on the left, and the plugin's one track in a column of
 * sections, as the app's workbench is: its devices, then its macros (the host's 16 knobs,
 * PLUGIN-3.4, which a knob's right-click menu maps). The keys (PLUGIN-3.11) and MIDI devices
 * (PLUGIN-3.8) come in as sections above the devices. No transport, timeline or engine here: the
 * plugin makes the sound, and `PluginDevice` tells it what to play.
 */
import { useRef } from "react";
import { applyEdit } from "../audio/commands/applyEdit";
import type { Dispatch } from "../audio/commands/types";
import type { SoundPreview } from "../audio/live/preview";
import type { ProjectStore } from "../audio/project/projectStore";
import { useProject } from "../audio/project/useProject";
import { ActivityRail } from "../ui/ActivityRail";
import { SectionHeader } from "../ui/controls/SectionHeader";
import { requestExploreSearch } from "../ui/explore/explorePage";
import { RAIL_ITEMS } from "../ui/libraryViews";
import { KnobExtrasProvider } from "../ui/knobExtras";
import { usePersistentBoolean } from "../ui/usePersistent";
import { DeviceRack } from "../ui/workbench/DeviceRack";
import { DevicesBar } from "../ui/workbench/DevicesBar";
import { MacroStrip } from "./MacroStrip";
import type { PluginDevice } from "./pluginDevice";
import { PluginExplore } from "./PluginExplore";
import type { PluginMacros } from "./pluginMacros";
import { useMacros } from "./useMacros";

/** The rail's views the plugin has: Explore. Projects, activity and the agent are the app's. */
const PLUGIN_RAIL = RAIL_ITEMS.filter((item) => item.view === "explore");

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
  const [panelCollapsed, setPanelCollapsed] = usePersistentBoolean("corrente:plugin-panel-collapsed", false);
  const [devicesOpen, setDevicesOpen] = usePersistentBoolean("corrente:plugin-devices-open", true);
  const [macrosOpen, setMacrosOpen] = usePersistentBoolean("corrente:plugin-macros-open", true);
  const columnRef = useRef<HTMLElement>(null);
  const scrollToDevice = (key: string) =>
    columnRef.current
      ?.querySelector(`[data-device="${CSS.escape(key)}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });

  return (
    <div className="h-screen flex bg-ground text-ink">
      <ActivityRail
        active="explore"
        collapsed={panelCollapsed}
        items={PLUGIN_RAIL}
        onSelect={() => setPanelCollapsed(false)}
        onToggleCollapse={() => setPanelCollapsed(!panelCollapsed)}
        onSearch={() => {
          setPanelCollapsed(false);
          requestExploreSearch();
        }}
      />
      {!panelCollapsed && (
        <div className="w-80 shrink-0 flex min-h-0">
          <PluginExplore project={project} dispatch={dispatch} preview={preview} />
        </div>
      )}
      <main ref={columnRef} className="relative isolate flex-1 min-w-0 overflow-y-auto">
        {track ? (
          <section aria-label="Devices">
            <DevicesBar
              track={track}
              projectStore={project}
              open={devicesOpen}
              onToggle={() => setDevicesOpen(!devicesOpen)}
              onDevice={scrollToDevice}
            />
            {devicesOpen && (
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
            )}
          </section>
        ) : (
          <p className="p-4 text-muted">No track to show.</p>
        )}
        <section aria-label="Macros" className="pb-6">
          <SectionHeader title="Macros" fold={{ open: macrosOpen, onToggle: () => setMacrosOpen(!macrosOpen) }} />
          {macrosOpen && <MacroStrip view={macroView} />}
        </section>
      </main>
    </div>
  );
}
