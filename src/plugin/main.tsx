/**
 * The plugin window's page (PLUGIN-3.2), `plugin.html`: it asks the plugin for the rack it saved,
 * then shows it and sends the plugin what to play, and what Explore tries (PLUGIN-3.5), and lets
 * Claude drive it through the local MCP server while it's open (PLUGIN-4). The plugin answers through
 * `window.corrente`, and hears the page through wry's `window.ipc`. Opened in a plain browser, where
 * there is no plugin, it starts afresh and logs what it would have sent, for working on the page.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/google-sans-flex/wght.css";
import "@fontsource-variable/google-sans-code/wght.css";
import "../index.css";
import { DEFAULT_INSTRUMENT } from "../audio/instruments/catalog";
import { startLibrary } from "../audio/library/account";
import { applyEdit } from "../audio/commands/applyEdit";
import { agentAuthor } from "../audio/commands/authors";
import { connectMcpBridge } from "../audio/mcp/bridge";
import { SoundPreview } from "../audio/live/preview";
import { ProjectStore } from "../audio/project/projectStore";
import { noteUsed } from "../ui/explore/recent/store";
import { applyStoredTheme } from "../ui/theme";
import { PluginApp } from "./PluginApp";
import { NO_SAMPLES, pageSamples, type SavedSamples } from "./pageSamples";
import { PluginDevice, projectOfRack, type ToPlugin } from "./pluginDevice";
import { PluginPreview } from "./pluginPreview";
import { PluginMacros, type Slots } from "./pluginMacros";
import { keysToHost } from "./keysToHost";
import { pluginNotes } from "./pluginKeys";
import { pageUpdates, type PageUpdates } from "./pageUpdates";

declare global {
  interface Window {
    /** wry's channel to the plugin (editor.rs), absent in a plain browser. */
    ipc?: { postMessage(message: string): void };
    /** What the plugin calls back: the saved rack and macro mapping, and a macro the host moved. */
    corrente?: {
      restore(rack: string | null, macros?: Slots | null, samples?: SavedSamples | null): void;
      macro(name: string, position: number): void;
      /** A newer build of this page is ready (HOST-23.2.3.1). */
      update(): void;
      /** A newer plugin is out; `needed` if this page's updates wait for it. */
      release(needed: boolean): void;
    };
  }
}

const send = (message: ToPlugin) =>
  window.ipc ? window.ipc.postMessage(JSON.stringify(message)) : console.info("[plugin]", message);

applyStoredTheme();

// Your library (patches and custom devices), as the app opens it: this window's own, kept in its
// storage, signed out (PLUGIN-3.5).
startLibrary();

const project = new ProjectStore(false);
const macros = new PluginMacros(send);
/** Only a page in the plugin asks: a plain browser has no newer build to be offered. */
const updates: PageUpdates | undefined = window.ipc ? pageUpdates(send) : undefined;
/** Made on restore, with the samples the plugin saved. */
let device: PluginDevice | undefined;

/**
 * Show the rack the plugin saved, or a fresh one playing what a new plugin plays, then start sending.
 * Samples are read from the window's storage, else from those the plugin saved (PLUGIN-3.6).
 */
const restore = (rack: string | null, slots: Slots | null, savedSamples: SavedSamples) => {
  macros.restore(slots);
  const samples = pageSamples(project, savedSamples);
  const saved = rack ? projectOfRack(rack) : undefined;
  if (saved) project.load(saved);
  else {
    if (rack) send({ type: "log", text: "the saved rack didn't read; starting afresh" });
    project.addTrack(DEFAULT_INSTRUMENT);
  }
  device = new PluginDevice(project, samples, send);
  device.start();
  // Claude through the local MCP server, as a browser tab of the app reaches it (PLUGIN-4): while this
  // window is open, and the one used last if there are several. Its edits apply as the agent's.
  const agent = agentAuthor("you");
  connectMcpBridge(
    {
      projectStore: project,
      editLog: { dispatchAsAgent: (command) => applyEdit(project, command, agent), agentAuthor: agent, note: () => {} },
    },
    { kind: "plugin" },
  );
  const preview = new SoundPreview(new PluginPreview(samples, send), noteUsed, project);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PluginApp
        project={project}
        preview={preview}
        device={device}
        macros={macros}
        notes={pluginNotes(send)}
        updates={updates}
      />
    </StrictMode>,
  );
};

// Once only: the plugin answers each `ready`, and a page reloaded in devtools asks again.
let restored = false;
window.corrente = {
  restore: (rack, slots, samples) => {
    if (restored) return;
    restored = true;
    restore(rack, slots ?? null, samples ?? NO_SAMPLES);
  },
  macro: (name, position) => device?.fromHost(name, position),
  update: () => updates?.ready.set(true),
  release: (needed) => {
    // A new object only when the news changes, so the store doesn't announce the same news every minute.
    if (updates && updates.release.read()?.needed !== needed) updates.release.set({ needed });
  },
};
if (window.ipc) {
  send({ type: "ready" });
  keysToHost(send);
} else window.corrente.restore(null);
