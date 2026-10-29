/**
 * Writes `dist/plugin-build.json` after `vite build` (HOST-23.2.3.1): the build's id, when it was
 * built, the engine and protocol it was built against, and every file with its sha256. See
 * src/plugin/pluginBuild.ts for what the plugin does with it.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PLUGIN_BUILD_FILE, PLUGIN_PROTOCOL, type PluginBuild } from "../src/plugin/pluginBuild.ts";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

const files = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(dist, join(entry.parentPath, entry.name)).split(sep).join("/"))
  .filter((path) => path !== PLUGIN_BUILD_FILE)
  .toSorted()
  .map((path) => ({ path, sha256: sha256(readFileSync(join(dist, path))) }));

const build: PluginBuild = {
  id: sha256(files.map((file) => `${file.path}:${file.sha256}`).join("\n")).slice(0, 16),
  built: Date.now(),
  engine: sha256(readFileSync(join(root, "engine", "engine.wasm"))).slice(0, 16),
  protocol: PLUGIN_PROTOCOL,
  files,
};
writeFileSync(join(dist, PLUGIN_BUILD_FILE), JSON.stringify(build, null, 2) + "\n");
console.info(`${PLUGIN_BUILD_FILE}: build ${build.id}, engine ${build.engine}, ${files.length} files`);
