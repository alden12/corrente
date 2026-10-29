/**
 * A newer build of the window's page, downloaded by the plugin from corrente.cloud (HOST-23.2.3.1,
 * updates.rs). The page asks now and then whether one is ready; the plugin answers through
 * `window.corrente.update`, and the app's update notice offers Reload, which reopens the page on it.
 * Nothing is lost: the rack, samples and macros are the plugin's, and the reopened page restores them.
 *
 * The plugin also says when a newer version of itself is out (`window.corrente.release`), and whether
 * the page's updates now wait for it: Download opens its release in the browser.
 */
import { PLUGIN_URL } from "../hosting";
import { createValueStore, type ValueStore } from "../listeners";
import type { ToPlugin } from "./pluginDevice";

/** How often the page asks: the plugin only looks in its own folder, so this is cheap. */
const ASK_EVERY_MS = 60_000;

export interface PageUpdates {
  /** Whether a newer build is ready to reload onto. */
  ready: ValueStore<boolean>;
  reload: () => void;
  /** A newer plugin, once the plugin has seen one: `needed` if the page's updates wait for it. */
  release: ValueStore<{ needed: boolean } | null>;
  download: () => void;
}

/** Ask the plugin now and every minute after; `ready` and `release` change as it answers. */
export function pageUpdates(send: (message: ToPlugin) => void): PageUpdates {
  const ask = () => send({ type: "update" });
  ask();
  setInterval(ask, ASK_EVERY_MS);
  return {
    ready: createValueStore(false),
    reload: () => send({ type: "reload" }),
    release: createValueStore<{ needed: boolean } | null>(null),
    download: () => send({ type: "open", url: PLUGIN_URL }),
  };
}
