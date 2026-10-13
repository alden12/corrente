/**
 * The block catalogue (INST-36.2) as the app reads it: every block the engine can run, with its
 * ports, ranges and licences, generated from the block sources beside engine.wasm. Pure data, so
 * the compiler, the MCP servers and the UI all read the same thing.
 */
import catalogueJson from "../../../engine/catalogue.json";
import type { BlockSpec, Catalogue } from "../../../engine/catalogue.ts";

export type { BlockSpec, Control, Port } from "../../../engine/catalogue.ts";

export const CATALOGUE: Catalogue = catalogueJson;

const byName = new Map(CATALOGUE.blocks.map((block) => [block.name, block]));

/** The block called `name`, if there is one. */
export const blockNamed = (name: string): BlockSpec | undefined => byName.get(name);
