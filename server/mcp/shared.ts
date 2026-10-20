/**
 * What every group of MCP tools shares: id minters, the device-format document, and the text
 * result shapes. Pure data and helpers, with no project or transport in sight.
 */
import { DEVICE_COLOR_NAMES } from "../../src/audio/deviceColors";
import { z } from "zod";
import { definitionFormatDoc } from "../../src/audio/definitions/describe";
import { paramSpecSchema } from "../../src/audio/params/declaration";

/** The param kinds a schema may declare, read off the same zod that checks them. */
const paramKindsDoc = z.toJSONSchema(paramSpecSchema) as Record<string, unknown>;
delete paramKindsDoc.$schema; // a bare schema, as the agent's tools give one

export const randomId = () => crypto.randomUUID();
export const makeTrackId = () => `t-${randomId().slice(0, 8)}`;
export const makeGroupId = () => `g-${randomId().slice(0, 8)}`;
export const makeEffectId = () => `fx-${randomId().slice(0, 8)}`;
export const makeMidiDeviceId = () => `md-${randomId().slice(0, 8)}`;
export const makeClipId = () => `c-${randomId().slice(0, 8)}`;
export const makePlacementId = () => `p-${randomId().slice(0, 8)}`;
export const makeCustomInstrumentId = () => `ci-${randomId().slice(0, 8)}`;
export const makeCustomEffectId = () => `ce-${randomId().slice(0, 8)}`;

/** The custom-device format, as data the AI can read before authoring one: the engine's, in a wrapper. */
export const deviceFormatDoc = () => ({
  device:
    "A custom instrument or effect is { label?, color?, schema, definition }. `schema` is its params (the keystone: they " +
    "drive the panel, automation and saving), `definition` the engine definition described below, which reads " +
    "them as { param: id }. An instrument's definition has voice nodes; an effect's has none and reads " +
    "input.left and input.right. It's checked by compiling it, and every problem comes back at once.",
  color: `Its colour in the rack and on Explore, one of ${DEVICE_COLOR_NAMES.join(", ")}. Pick one unlike the devices it usually sits beside (built-in delays are blue, reverbs indigo, choruses green, drives red); omitted, one is picked from its type.`,
  params:
    "`schema` is a list of params, each one of `paramKinds`. A sample param's default is a sample ref; " +
    "`wavetable: true` offers the built-in wavetables in its picker. A level is a number param into a mul; " +
    "dry/wet is the chain's, by a `mix` param (see `effects`).",
  levels:
    "Gain-stage so it sits with the built-ins: a single held note around -10 dBFS at its default level, so a " +
    "five-note chord stays under about +6 dBFS (voices sum). create_* and update_* play the device alone and " +
    "report it (peak, chord peak, how soon it goes quiet), with a PROBLEM for silence, NaN, a runaway or a sound " +
    "that never stops; fix those before using it.",
  paramKinds: paramKindsDoc,
  ...definitionFormatDoc(),
  designing:
    'To design to a brief ("warm and a bit eerie"), look its words up with list_patches\' `tags` first: the ' +
    "patches carrying them are worked examples, and a tag's note says how to build it on these blocks and what " +
    "analyze_device shows when it landed.",
});

export type ToolResult = {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError?: boolean;
};
export const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
export const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
