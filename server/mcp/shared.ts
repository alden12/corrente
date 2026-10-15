/**
 * What every group of MCP tools shares: id minters, the device-format document, and the text
 * result shapes. Pure data and helpers, with no project or transport in sight.
 */
import { definitionFormatDoc } from "../../src/audio/definitions/describe";

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
    "A custom instrument or effect is { label?, schema, definition }. `schema` is its params (the keystone: they " +
    "drive the panel, automation and saving), `definition` the engine definition described below, which reads " +
    "them as { param: id }. An instrument's definition has voice nodes; an effect's has none and reads " +
    "input.left and input.right. It's checked by compiling it, and every problem comes back at once.",
  params:
    "Each schema entry is { id, label, kind, default, ... }: kind number (min, max, unit?, taper?: linear | " +
    'exponential, step?, format?: "note"), enum (options), boolean, or sample (a sample ref; wavetable?: true ' +
    "offers the built-in wavetables). A level is a number param into a mul; dry/wet is two muls summed.",
  ...definitionFormatDoc(),
});

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
export const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
