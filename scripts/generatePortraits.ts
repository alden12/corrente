/**
 * Regenerate the built-ins' Explore portraits (COMM-1.9.2): `yarn portraits`.
 *
 * Portraits are drawn from a real render of each device on the engine render core (AGENT-4.9), here
 * in Node, and written to `src/ui/explore/portraits.json`. That file is committed, so the app draws
 * portraits on load without rendering anything. Run it after adding or retuning a built-in;
 * `test/portraits.test.ts` fails until every built-in has one.
 */
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { renderPortraits } from "../src/audio/portraits/renderPortraits";
import { nodeRenderSetup } from "../server/render/nodeRender";

const OUTPUT = "src/ui/explore/portraits.json";

const portraits = await renderPortraits(nodeRenderSetup());
await writeFile(OUTPUT, `${JSON.stringify(portraits, null, 2)}\n`);
execFileSync("npx", ["prettier", "--write", OUTPUT], { stdio: "ignore" });
console.log(`Wrote ${Object.keys(portraits).length} portraits to ${OUTPUT}`);
