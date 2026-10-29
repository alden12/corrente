/**
 * Custom MIDI devices (INST-11.3): MIDI devices a person or an agent wrote, stored in their project,
 * each a param schema and a definition in the MIDI format (format.ts), as custom instruments and
 * effects are (definitions/custom.ts). A device is checked by compiling it, so one that loads is one
 * the engine plays. DOM-free: the MCP servers check what they're sent with the same code.
 */
import { z } from "zod";
import { paramSchemaSchema } from "../params/declaration";
import type { ParamSchema } from "../params/types";
import { DEVICE_COLOR_NAMES, type DeviceColor } from "../deviceColors";
import { issueLines } from "../../util";
import { compileMidiDevice, MidiDefinitionError } from "./compile";
import type { MidiDefinition } from "./format";

export interface CustomMidiDevice {
  type: string;
  label?: string;
  color?: DeviceColor;
  schema: ParamSchema;
  definition: MidiDefinition;
}

/** The shape, before its definition is compiled. */
const customMidiDeviceSchema = z.strictObject({
  type: z.string().min(1),
  label: z.string().optional(),
  color: z.enum(DEVICE_COLOR_NAMES).optional(),
  schema: paramSchemaSchema,
  definition: z.unknown(),
});

export type MidiDeviceResult = { ok: true; device: CustomMidiDevice } | { ok: false; errors: string[] };

/** Check a custom MIDI device: its shape, then its definition compiled against its schema. */
export const parseCustomMidiDevice = (raw: unknown): MidiDeviceResult => {
  const parsed = customMidiDeviceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: issueLines(parsed.error) };
  const schema = parsed.data.schema as ParamSchema;
  try {
    compileMidiDevice(parsed.data.definition, schema);
  } catch (error) {
    if (error instanceof MidiDefinitionError) return { ok: false, errors: error.problems };
    throw error;
  }
  return { ok: true, device: { ...parsed.data, schema, definition: parsed.data.definition as MidiDefinition } };
};

/**
 * A project's custom MIDI devices, setting aside any that don't pass (with a warning) as `unreadable`,
 * kept as stored for the project to write back out: a newer build may read them. Never throws.
 */
export const parseCustomMidiDevices = (raw: unknown): { devices: CustomMidiDevice[]; unreadable: unknown[] } => {
  const results = (Array.isArray(raw) ? raw : []).map((entry) => ({ entry, result: parseCustomMidiDevice(entry) }));
  results.forEach(({ result }) => {
    if (!result.ok) console.warn(`Not playing a custom MIDI device: ${result.errors.join("; ")}`);
  });
  return {
    devices: results.flatMap(({ result }) => (result.ok ? [result.device] : [])),
    unreadable: results.filter(({ result }) => !result.ok).map(({ entry }) => entry),
  };
};
