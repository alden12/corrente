/**
 * The plugin window's page (PLUGIN-3.2), `plugin.html`: it asks the plugin for the rack it saved,
 * then shows it and sends the plugin what to play, and what Explore tries (PLUGIN-3.5). The plugin answers through `window.corrente`, and
 * hears the page through wry's `window.ipc`. Opened in a plain browser, where there is no plugin, it
 * starts afresh and logs what it would have sent, for working on the page.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/google-sans-flex/wght.css";
import "@fontsource-variable/google-sans-code/wght.css";
import "../index.css";
import { DEFAULT_INSTRUMENT } from "../audio/instruments/catalog";
import { startLibrary } from "../audio/library/account";
import { SoundPreview } from "../audio/live/preview";
import { ProjectStore } from "../audio/project/projectStore";
import { noteUsed } from "../ui/explore/recent/store";
import { applyStoredTheme } from "../ui/theme";
import { PluginApp } from "./PluginApp";
import { pageSamples } from "./pageSamples";
import { PluginDevice, projectOfRack, type ToPlugin } from "./pluginDevice";
import { PluginPreview } from "./pluginPreview";
import { PluginMacros, type Slots } from "./pluginMacros";
import { keysToHost } from "./keysToHost";

declare global {
  interface Window {
    /** wry's channel to the plugin (editor.rs), absent in a plain browser. */
    ipc?: { postMessage(message: string): void };
    /** What the plugin calls back: the saved rack and macro mapping, and a macro the host moved. */
    corrente?: {
      restore(rack: string | null, macros?: Slots | null): void;
      macro(name: string, position: number): void;
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
const device = new PluginDevice(project, pageSamples, send);
const macros = new PluginMacros(send);

/** Show the rack the plugin saved, or a fresh one playing what a new plugin plays, then start sending. */
const restore = (rack: string | null, slots: Slots | null) => {
  macros.restore(slots);
  const saved = rack ? projectOfRack(rack) : undefined;
  if (saved) project.load(saved);
  else {
    if (rack) send({ type: "log", text: "the saved rack didn't read; starting afresh" });
    project.addTrack(DEFAULT_INSTRUMENT);
  }
  device.start();
  const preview = new SoundPreview(new PluginPreview(pageSamples, send), noteUsed, project);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PluginApp project={project} preview={preview} device={device} macros={macros} />
    </StrictMode>,
  );
};

// Once only: the plugin answers each `ready`, and a page reloaded in devtools asks again.
let restored = false;
window.corrente = {
  restore: (rack, slots) => {
    if (restored) return;
    restored = true;
    restore(rack, slots ?? null);
  },
  macro: (name, position) => device.fromHost(name, position),
};
if (window.ipc) {
  send({ type: "ready" });
  keysToHost(send);
} else window.corrente.restore(null);
