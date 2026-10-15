/** MCP tools: Custom devices (author instruments and effects for the engine, stored in the project). */
import { z } from "zod";
import { parseCustomDevice, type CustomKind } from "../../../src/audio/definitions/custom";
import { makeCustomInstrumentId, makeCustomEffectId, deviceFormatDoc, ok, fail } from "../shared";
import type { ToolContext } from "../context";

/**
 * What an author sends: everything but the `type` id (the server mints that). **An outline, not the
 * format**: the full schema made the authoring tools' JSON schemas too big for a client to surface
 * (the claude.ai client never showed them). `describe_device_format` explains the format, and
 * parseCustomDevice checks every device in full, naming each problem.
 */
const deviceInput = {
  label: z.string().optional(),
  schema: z
    .array(z.record(z.string(), z.unknown()))
    .describe("Param declarations, each { id, label, kind, ... } - see describe_device_format."),
  definition: z
    .record(z.string(), z.unknown())
    .describe("The engine definition, { format, nodes, voice?, output?, ... } - see describe_device_format."),
};

export function registerCustomDevicesTools({ server, target, trackArg, resolveTrack }: ToolContext): void {
  /** The project's devices of a kind, and how to store one. */
  const KINDS = {
    instrument: {
      list: () => target.project.customInstruments,
      add: "addCustomInstrument",
      update: "updateCustomInstrument",
      store: (device: Parameters<typeof target.project.addCustomInstrument>[0]) =>
        target.project.addCustomInstrument(device),
      use: "create_track with instrument",
    },
    effect: {
      list: () => target.project.customEffects,
      add: "addCustomEffect",
      update: "updateCustomEffect",
      store: (device: Parameters<typeof target.project.addCustomEffect>[0]) => target.project.addCustomEffect(device),
      use: "add_effect with effect",
    },
  } as const;

  server.registerTool(
    "describe_device_format",
    {
      title: "Describe device format",
      description:
        "The format for custom instruments and effects: params, the engine's blocks with their ports and ranges, and how to wire them. Read this before create_instrument / create_effect.",
      inputSchema: {},
    },
    async () => ok(JSON.stringify(deviceFormatDoc(), null, 2)),
  );

  const invalid = (kind: CustomKind, errors: string[]) =>
    fail(`Invalid ${kind}:\n${errors.map((error) => `- ${error}`).join("\n")}`);

  const create = (kind: CustomKind, type: string, input: { label?: string; schema: unknown; definition: unknown }) => {
    const result = parseCustomDevice({ type, ...input }, kind);
    if (!result.ok) return invalid(kind, result.errors);
    if (!target.send({ type: KINDS[kind].add, def: result.device })) return fail("No DAW tab connected.");
    KINDS[kind].store(result.device);
    return ok(`Created ${kind} "${input.label ?? type}" (type ${type}). Use ${KINDS[kind].use} "${type}".`);
  };

  const update = (
    kind: CustomKind,
    deviceType: string,
    input: { label?: string; schema: unknown; definition: unknown },
  ) => {
    const current = KINDS[kind].list().find((device) => device.type === deviceType);
    if (!current) return fail(`No custom ${kind} with type "${deviceType}". Use list_custom_devices.`);
    const result = parseCustomDevice({ ...input, type: deviceType, label: input.label ?? current.label }, kind);
    if (!result.ok) return invalid(kind, result.errors);
    if (!target.send({ type: KINDS[kind].update, def: result.device })) return fail("No DAW tab connected.");
    KINDS[kind].store(result.device);
    return ok(`Updated ${kind} "${result.device.label ?? deviceType}" (type ${deviceType}).`);
  };

  server.registerTool(
    "create_instrument",
    {
      title: "Create custom instrument",
      description:
        "Author a custom instrument (see describe_device_format) and store it in the project. Returns its type id; use it with create_track.",
      inputSchema: deviceInput,
    },
    async (input) => create("instrument", makeCustomInstrumentId(), input),
  );

  server.registerTool(
    "create_effect",
    {
      title: "Create custom effect",
      description:
        "Author a custom effect (see describe_device_format; no voice nodes, reading input.left and input.right) and store it in the project. Returns its type id; use it with add_effect.",
      inputSchema: deviceInput,
    },
    async (input) => create("effect", makeCustomEffectId(), input),
  );

  server.registerTool(
    "update_instrument",
    {
      title: "Edit custom instrument",
      description:
        "Replace a custom instrument's definition, keeping its type id, so every track playing it picks up the change (params it still has keep their values). Pass the whole new device: read the current one with get_custom_device, change it, send it back. Omit label to keep the current one.",
      inputSchema: { deviceType: z.string(), ...deviceInput },
    },
    async ({ deviceType, ...input }) => update("instrument", deviceType, input),
  );

  server.registerTool(
    "update_effect",
    {
      title: "Edit custom effect",
      description:
        "Replace a custom effect's definition, keeping its type id, so every slot holding it picks up the change (params it still has keep their values). Pass the whole new device: read the current one with get_custom_device, change it, send it back. Omit label to keep the current one.",
      inputSchema: { deviceType: z.string(), ...deviceInput },
    },
    async ({ deviceType, ...input }) => update("effect", deviceType, input),
  );

  server.registerTool(
    "get_custom_device",
    {
      title: "Get custom device",
      description:
        "A custom instrument's or effect's full device (label, schema and definition), to read before update_instrument / update_effect.",
      inputSchema: { deviceType: z.string() },
    },
    async ({ deviceType }) => {
      const instrument = target.project.customInstruments.find((def) => def.type === deviceType);
      if (instrument) return ok(JSON.stringify({ kind: "instrument", ...instrument }, null, 2));
      const effect = target.project.customEffects.find((def) => def.type === deviceType);
      if (effect) return ok(JSON.stringify({ kind: "effect", ...effect }, null, 2));
      return fail(`No custom device with type "${deviceType}". Use list_custom_devices.`);
    },
  );

  server.registerTool(
    "list_custom_devices",
    {
      title: "List custom devices",
      description:
        "The project's user/AI-authored instruments and effects. `uses` counts the tracks playing an instrument or the slots holding an effect; one at 0 is safe to remove.",
      inputSchema: {},
    },
    async () => {
      const describe = (def: { type: string; label?: string; schema: readonly unknown[] }) => ({
        type: def.type,
        label: def.label ?? def.type,
        params: def.schema.length,
        uses: target.project.customDeviceUses(def.type),
      });
      return ok(
        JSON.stringify(
          {
            instruments: target.project.customInstruments.map(describe),
            effects: target.project.customEffects.map(describe),
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    "remove_custom_device",
    {
      title: "Remove custom device",
      description: "Delete a custom instrument or effect by its type id (see list_custom_devices).",
      inputSchema: { deviceType: z.string() },
    },
    async ({ deviceType }) => {
      if (target.project.customInstruments.some((def) => def.type === deviceType)) {
        if (!target.send({ type: "removeCustomInstrument", deviceType })) return fail("No DAW tab connected.");
        target.project.removeCustomInstrument(deviceType);
        return ok(`Removed custom instrument ${deviceType}.`);
      }
      if (target.project.customEffects.some((def) => def.type === deviceType)) {
        if (!target.send({ type: "removeCustomEffect", deviceType })) return fail("No DAW tab connected.");
        target.project.removeCustomEffect(deviceType);
        return ok(`Removed custom effect ${deviceType}.`);
      }
      return fail(`No custom device with type "${deviceType}". Use list_custom_devices.`);
    },
  );

  server.registerTool(
    "set_track",
    {
      title: "Set track",
      description: "Set a track's mute, solo, volume (0..1), and/or name.",
      inputSchema: {
        ...trackArg,
        muted: z.boolean().optional(),
        solo: z.boolean().optional(),
        volume: z.number().min(0).max(1).optional(),
        name: z.string().optional(),
      },
    },
    async ({ track, muted, solo, volume, name }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "setTrack", trackId: r.id, muted, solo, volume, name }))
        return fail("No DAW tab connected.");
      if (muted !== undefined) target.project.setMuted(r.id, muted);
      if (solo !== undefined) target.project.setSolo(r.id, solo);
      if (volume !== undefined) target.project.setVolume(r.id, volume);
      if (name !== undefined) target.project.renameTrack(r.id, name);
      return ok(`Updated track ${r.id}.`);
    },
  );
}
