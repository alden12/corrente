/**
 * Custom devices (INST-36.8): instruments and effects a person or an agent wrote, stored in their
 * project, each a param schema and a definition for the engine. One shape for both: an instrument's
 * definition has voice nodes, an effect's has none and reads the track's input.
 *
 * A device is checked by compiling it, so one that loads is one that plays (and fits a phone). DOM-free:
 * the MCP servers check what they're sent with the same code.
 */
import { z } from "zod";
import { paramSchemaSchema } from "../params/declaration";
import type { ParamSchema } from "../params/types";
import { compileDefinition, DefinitionError } from "./compile";
import type { AuthoredDefinition } from "./format";
import { hasVoiceNodes } from "./references";
import { issueLines } from "../../util";

/**
 * The version of the custom-device shape a project stores. 1 was the graph format the old engine
 * played; projects holding it were converted once, with their history (decided 2026-10-15).
 */
export const DEVICE_FORMAT_VERSION = 2;

export interface CustomDevice {
  type: string;
  label?: string;
  schema: ParamSchema;
  definition: AuthoredDefinition;
}

export type CustomKind = "instrument" | "effect";

/** The shape, before its definition is compiled. */
const customDeviceSchema = z.strictObject({
  type: z.string().min(1),
  label: z.string().optional(),
  schema: paramSchemaSchema,
  definition: z.unknown(),
});

export type DeviceResult = { ok: true; device: CustomDevice } | { ok: false; errors: string[] };

/** What makes a definition the wrong kind of device, if anything. */
const KIND_PROBLEMS: Record<CustomKind, (definition: AuthoredDefinition) => string | undefined> = {
  instrument: (definition) =>
    hasVoiceNodes(definition) ? undefined : "an instrument needs voice nodes (`voice: true`) to play its notes",
  effect: (definition) =>
    hasVoiceNodes(definition) ? "an effect has no voices: read `input.left` and `input.right` instead" : undefined,
};

/** Check a custom device of one kind: its shape, then its definition compiled against its schema. */
export const parseCustomDevice = (raw: unknown, kind: CustomKind): DeviceResult => {
  const parsed = customDeviceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: issueLines(parsed.error) };
  const schema = parsed.data.schema as ParamSchema;
  try {
    compileDefinition(parsed.data.definition, { params: schema });
  } catch (error) {
    if (error instanceof DefinitionError) return { ok: false, errors: error.problems };
    throw error;
  }
  const device = { ...parsed.data, schema, definition: parsed.data.definition as AuthoredDefinition };
  const problem = KIND_PROBLEMS[kind](device.definition);
  return problem ? { ok: false, errors: [problem] } : { ok: true, device };
};

/** The devices `parseCustomDevices` could not read, exactly as they were stored. */
export interface UnreadableDevices {
  instruments: unknown[];
  effects: unknown[];
}

/**
 * A project's custom devices, dropping any that don't pass (with a warning). Never throws: a device
 * that won't read must not stop the project from opening.
 *
 * What it drops comes back as `unreadable`, untouched, for the project to write back out: a device
 * this build can't read may be one a newer build can (a block added since), and opening the project
 * here must not be what deletes it. A project from another format version keeps all of them that way.
 */
export const parseCustomDevices = (data: {
  customInstruments?: unknown;
  customEffects?: unknown;
  deviceFormatVersion?: number;
}): { instruments: CustomDevice[]; effects: CustomDevice[]; unreadable: UnreadableDevices } => {
  const entries = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);
  const stored = { instruments: entries(data.customInstruments), effects: entries(data.customEffects) };
  const version = data.deviceFormatVersion ?? DEVICE_FORMAT_VERSION;
  if (version !== DEVICE_FORMAT_VERSION && stored.instruments.length + stored.effects.length > 0) {
    console.warn(`Not playing custom devices: format version ${version}, this build reads ${DEVICE_FORMAT_VERSION}.`);
    return { instruments: [], effects: [], unreadable: stored };
  }
  const sort = (raw: unknown[], kind: CustomKind) => {
    const results = raw.map((entry) => ({ entry, result: parseCustomDevice(entry, kind) }));
    results.forEach(({ result }) => {
      if (!result.ok) console.warn(`Not playing a custom ${kind}: ${result.errors.join("; ")}`);
    });
    return {
      kept: results.flatMap(({ result }) => (result.ok ? [result.device] : [])),
      dropped: results.filter(({ result }) => !result.ok).map(({ entry }) => entry),
    };
  };
  const instruments = sort(stored.instruments, "instrument");
  const effects = sort(stored.effects, "effect");
  return {
    instruments: instruments.kept,
    effects: effects.kept,
    unreadable: { instruments: instruments.dropped, effects: effects.dropped },
  };
};
