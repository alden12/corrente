/**
 * The plugin's window, laid out like the app's desktop (PLUGIN-3.12): the activity rail and the
 * panel it has open (Explore, PLUGIN-3.5) on the left, and the plugin's one track in a column of
 * sections, as the app's workbench is: the keys (PLUGIN-3.11), its macros (the host's 16 knobs,
 * PLUGIN-3.4, which a knob's right-click menu maps), then its devices. The keys and macros start
 * folded, so the devices open in view. MIDI devices (PLUGIN-3.8) come in as a section above the devices. No transport, timeline or engine here: the
 * plugin makes the sound, and `PluginDevice` tells it what to play.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { LiveNotes } from "../audio/live/liveNotes";
import { applyEdit } from "../audio/commands/applyEdit";
import type { Dispatch } from "../audio/commands/types";
import type { SoundPreview } from "../audio/live/preview";
import type { ProjectStore } from "../audio/project/projectStore";
import { useProject } from "../audio/project/useProject";
import { ActivityRail } from "../ui/ActivityRail";
import { SectionHeader } from "../ui/controls/SectionHeader";
import { openExplorePage, requestExploreSearch } from "../ui/explore/explorePage";
import { RAIL_ITEMS } from "../ui/libraryViews";
import { KnobExtrasProvider } from "../ui/knobExtras";
import { KeysPanel } from "../ui/keys/KeysPanel";
import { useDesktopKeys } from "../ui/keys/useDesktopKeys";
import { useSongKey } from "../ui/pads/songKey";
import { usePersistentBoolean } from "../ui/usePersistent";
import { DeviceRack } from "../ui/workbench/DeviceRack";
import { DevicesBar } from "../ui/workbench/DevicesBar";
import { UpdateNotice } from "../ui/UpdateNotice";
import { createValueStore } from "../listeners";
import { MacroStrip } from "./MacroStrip";
import type { PageUpdates } from "./pageUpdates";
import type { PluginDevice } from "./pluginDevice";
import { PluginExplore } from "./PluginExplore";
import { keyboardTaken } from "./pluginKeys";
import type { PluginMacros } from "./pluginMacros";
import { useMacros } from "./useMacros";

/** A page with nothing to update to: one opened in a plain browser. */
const NO_UPDATES: PageUpdates = {
  ready: createValueStore(false),
  reload: () => {},
  release: createValueStore<{ needed: boolean } | null>(null),
  download: () => {},
};

/** The rail's views the plugin has: Explore. Projects, activity and the agent are the app's. */
const PLUGIN_RAIL = RAIL_ITEMS.filter((item) => item.view === "explore");

export function PluginApp({
  project,
  preview,
  device,
  macros,
  notes,
  updates = NO_UPDATES,
}: {
  project: ProjectStore;
  preview: SoundPreview;
  device: PluginDevice;
  macros: PluginMacros;
  /** What the keys play: the plugin (`pluginNotes`). */
  notes: LiveNotes;
  /** A newer build of the page (HOST-23.2.3.1); none in a plain browser. */
  updates?: PageUpdates;
}) {
  useProject(project);
  const macroView = useMacros(device, macros);
  const track = project.getTracks()[0];
  // Edits apply straight to the project: nothing here is shared, versioned or undone yet.
  const dispatch: Dispatch = (command, author = "you") => applyEdit(project, command, author);
  const [panelCollapsed, setPanelCollapsed] = usePersistentBoolean("corrente:plugin-panel-collapsed", false);
  const [devicesOpen, setDevicesOpen] = usePersistentBoolean("corrente:plugin-devices-open", true);
  const [macrosOpen, setMacrosOpen] = usePersistentBoolean("corrente:plugin-macros-open", false);
  // The knobs wear their macro badges only while the macros show; mapping one by right-click works either way.
  const extras = macrosOpen ? macroView.extras : { ...macroView.extras, badge: () => undefined };
  const columnRef = useRef<HTMLElement>(null);
  // The window takes the computer keyboard while the keys are open, and hands it back to the host
  // (Live's computer MIDI keyboard) while they're folded; the pads play either way.
  const taken = useSyncExternalStore(keyboardTaken.subscribe, keyboardTaken.read);
  const keys = useDesktopKeys(notes, taken, useSongKey(project, dispatch), {
    key: "corrente:plugin-keys-open",
    initial: false,
  });
  const updateReady = useSyncExternalStore(updates.ready.subscribe, updates.ready.read);
  const release = useSyncExternalStore(updates.release.subscribe, updates.release.read);
  const keysOpen = keys.panel.open;
  useEffect(() => keyboardTaken.set(keysOpen), [keysOpen]);
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
        onSelect={() => (panelCollapsed ? setPanelCollapsed(false) : openExplorePage("home"))}
        onSearch={() => {
          setPanelCollapsed(false);
          requestExploreSearch();
        }}
      />
      {!panelCollapsed && (
        <div className="w-80 shrink-0 flex min-h-0">
          <PluginExplore
            project={project}
            dispatch={dispatch}
            preview={preview}
            onCollapse={() => setPanelCollapsed(true)}
          />
        </div>
      )}
      <main ref={columnRef} className="relative isolate flex-1 min-w-0 overflow-y-auto">
        {updateReady && <UpdateNotice onReload={updates.reload} />}
        {release && (
          <UpdateNotice
            message={
              release.needed
                ? "A new version of the plugin is out, and this window's updates need it."
                : "A new version of the plugin is out."
            }
            action="Download"
            onReload={updates.download}
          />
        )}
        <section aria-label="Keys" className="border-b border-line" style={{ height: keys.height }}>
          <KeysPanel {...keys.panel} />
        </section>
        {/* Ruled off from the devices while open; folded, its header's own rule does that. */}
        <section aria-label="Macros" className={macrosOpen ? "border-b border-line" : undefined}>
          <SectionHeader title="Macros" fold={{ open: macrosOpen, onToggle: () => setMacrosOpen(!macrosOpen) }} />
          {macrosOpen && <MacroStrip view={macroView} />}
        </section>
        {track ? (
          <section aria-label="Devices" className="pb-6">
            <DevicesBar
              track={track}
              projectStore={project}
              open={devicesOpen}
              onToggle={() => setDevicesOpen(!devicesOpen)}
              onDevice={scrollToDevice}
            />
            {devicesOpen && (
              <KnobExtrasProvider value={extras}>
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
      </main>
    </div>
  );
}
