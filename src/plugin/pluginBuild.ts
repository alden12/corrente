/**
 * What a build of the app says about itself to the plugin (HOST-23.2.3.1): `dist/plugin-build.json`,
 * written by `scripts/pluginBuild.ts` after `vite build`. corrente.cloud serves it with the rest of
 * `dist/`, and the plugin (plugin/corrente/src/updates.rs) reads it to decide whether to take a build
 * and to check every file it downloads.
 *
 * **A plugin takes only a build its binary can play:** one with the same engine (a hash of
 * `engine.wasm`, so any change to the engine counts) and the same `PLUGIN_PROTOCOL` as the build
 * built into it. Anything else waits for a new binary.
 */

/**
 * The page-to-plugin protocol: the messages each sends the other (`ToPlugin`, editor.rs's `Message`,
 * `window.corrente`) and the device package the plugin reads (devicePackage.ts, package.rs). Bump it
 * with any change an installed plugin would misread, so it keeps the build it has instead.
 */
export const PLUGIN_PROTOCOL = 1;

/** The manifest's name in `dist/`, and so its path on corrente.cloud. */
export const PLUGIN_BUILD_FILE = "plugin-build.json";

export interface PluginBuild {
  /** Which build this is: a hash over every file's path and hash, so the same files are the same build. */
  id: string;
  /** When it was built, in milliseconds since 1970: a plugin takes a build newer than the one it has. */
  built: number;
  /** The engine it was built against: the start of `engine.wasm`'s sha256. */
  engine: string;
  protocol: number;
  /** Every file of `dist/` but this one: its path, with forward slashes, and its sha256 as hex. */
  files: { path: string; sha256: string }[];
}
