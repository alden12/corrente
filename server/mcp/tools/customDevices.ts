/** MCP tools: Custom devices (author instruments, effects and MIDI devices for the engine, stored in the project). */
import { z } from "zod";
import { parseCustomDevice, type CustomKind } from "../../../src/audio/definitions/custom";
import { DEVICE_COLOR_NAMES, type DeviceColor } from "../../../src/audio/deviceColors";
import {
  makeCustomInstrumentId,
  makeCustomEffectId,
  makeCustomMidiDeviceId,
  deviceFormatDoc,
  ok,
  fail,
} from "../shared";
import { parseCustomMidiDevice } from "../../../src/audio/midi/custom";
import type { ToolContext } from "../context";
import type { DeviceEdit } from "../../../src/audio/mcp/protocol";
import { checkEffect, checkInstrument } from "../../../src/audio/render/deviceCheck";
import { DeviceRenderError } from "../../../src/audio/render/renderDevice";
import { nodeRenderSetup } from "../../render/nodeRender";

/**
 * What an author sends: everything but the `type` id (the server mints that). **An outline, not the
 * format**: the full schema made the authoring tools' JSON schemas too big for a client to surface
 * (the claude.ai client never showed them). `describe_device_format` explains the format, and
 * parseCustomDevice checks every device in full, naming each problem.
 */
const deviceInput = {
  label: z.string().optional(),
  color: z
    .enum(DEVICE_COLOR_NAMES)
    .optional()
    .describe(
      "Its colour in the rack and on Explore. Pick one unlike the devices it usually sits beside; omitted, one is picked from its type.",
    ),
  schema: z
    .array(z.record(z.string(), z.unknown()))
    .describe("Param declarations, each { id, label, kind, ... } - see describe_device_format."),
  definition: z
    .record(z.string(), z.unknown())
    .describe("The engine definition, { format, nodes, voice?, output?, ... } - see describe_device_format."),
};

type DeviceInput = { label?: string; color?: DeviceColor; schema: unknown; definition: unknown };

/** How each kind is played to check it. */
const CHECKS = { instrument: checkInstrument, effect: checkEffect } as const;

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
        "The format for custom instruments, effects and MIDI devices: params, the engine's blocks with their ports and ranges, the MIDI event nodes, and how to wire them. Read this before create_instrument / create_effect / create_midi_device.",
      inputSchema: {},
    },
    async () => ok(JSON.stringify(deviceFormatDoc(), null, 2)),
  );

  const invalid = (kind: CustomKind, errors: string[]) =>
    fail(`Invalid ${kind}:\n${errors.map((error) => `- ${error}`).join("\n")}`);

  /**
   * Play the device just stored, alone, and say how it went (AGENT-4.8): the author can't hear it,
   * so this is how a silent, NaN or runaway device is caught in the same turn.
   */
  const check = async (kind: CustomKind, type: string): Promise<string> => {
    try {
      const verdict = await CHECKS[kind]({ type }, nodeRenderSetup());
      return `\nCheck (played alone): ${verdict.summary}`;
    } catch (error) {
      if (error instanceof DeviceRenderError) return `\nCheck: couldn't play it alone (${error.message}).`;
      throw error;
    }
  };

  /** Land a device edit, waiting until it has; a failure to tell the agent if it didn't. */
  const land = async (edit: DeviceEdit) => {
    try {
      const reply = await target.landDevice(edit);
      return reply.ok ? undefined : fail(`The device didn't land: ${reply.error ?? "no reason given"}.`);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };

  const create = async (kind: CustomKind, type: string, input: DeviceInput) => {
    const result = parseCustomDevice({ type, ...input }, kind);
    if (!result.ok) return invalid(kind, result.errors);
    const landed = await land({ type: KINDS[kind].add, def: result.device });
    if (landed) return landed;
    KINDS[kind].store(result.device);
    return ok(
      `Created ${kind} "${input.label ?? type}" (type ${type}). Use ${KINDS[kind].use} "${type}".${await check(kind, type)}`,
    );
  };

  const update = async (kind: CustomKind, deviceType: string, input: DeviceInput) => {
    const current = KINDS[kind].list().find((device) => device.type === deviceType);
    if (!current) return fail(`No custom ${kind} with type "${deviceType}". Use list_custom_devices.`);
    const result = parseCustomDevice(
      { ...input, type: deviceType, label: input.label ?? current.label, color: input.color ?? current.color },
      kind,
    );
    if (!result.ok) return invalid(kind, result.errors);
    const landed = await land({ type: KINDS[kind].update, def: result.device });
    if (landed) return landed;
    KINDS[kind].store(result.device);
    return ok(
      `Updated ${kind} "${result.device.label ?? deviceType}" (type ${deviceType}).${await check(kind, deviceType)}`,
    );
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
        "Replace a custom instrument's definition, keeping its type id, so every track playing it picks up the change (params it still has keep their values). Pass the whole new device: read the current one with get_custom_device, change it, send it back. Omit label or color to keep the current ones.",
      inputSchema: { deviceType: z.string(), ...deviceInput },
    },
    async ({ deviceType, ...input }) => update("instrument", deviceType, input),
  );

  server.registerTool(
    "update_effect",
    {
      title: "Edit custom effect",
      description:
        "Replace a custom effect's definition, keeping its type id, so every slot holding it picks up the change (params it still has keep their values). Pass the whole new device: read the current one with get_custom_device, change it, send it back. Omit label or color to keep the current ones.",
      inputSchema: { deviceType: z.string(), ...deviceInput },
    },
    async ({ deviceType, ...input }) => update("effect", deviceType, input),
  );

  /**
   * A MIDI device: checked here, then sent as an edit like any other (no library yet), so it lands
   * in the open app and the server's copy of the project together.
   */
  const storeMidi = (
    verb: "Created" | "Updated",
    type: string,
    input: DeviceInput,
    current?: { label?: string; color?: DeviceColor },
  ) => {
    const result = parseCustomMidiDevice({
      ...input,
      type,
      label: input.label ?? current?.label,
      color: input.color ?? current?.color,
    });
    if (!result.ok) return fail(`Invalid MIDI device:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
    const command = verb === "Created" ? "addCustomMidiDevice" : "updateCustomMidiDevice";
    if (!target.send({ type: command, def: result.device })) return fail(target.whyNotConnected());
    target.project.addCustomMidiDevice(result.device);
    return ok(
      `${verb} MIDI device "${result.device.label ?? type}" (type ${type}).` +
        (verb === "Created" ? ` Use add_midi_device with device "${type}".` : ""),
    );
  };

  server.registerTool(
    "create_midi_device",
    {
      title: "Create custom MIDI device",
      description:
        "Author a custom MIDI device (see describe_device_format's midiDevice and midiNodes) and store it in the project. It changes a track's notes before its instrument: arpeggiate, strum, harmonise, add rhythm. Returns its type id; use it with add_midi_device.",
      inputSchema: deviceInput,
    },
    async (input) => storeMidi("Created", makeCustomMidiDeviceId(), input),
  );

  server.registerTool(
    "update_midi_device",
    {
      title: "Edit custom MIDI device",
      description:
        "Replace a custom MIDI device's definition, keeping its type id, so every track using it picks up the change (params it still has keep their values). Pass the whole new device: read it with get_custom_device, change it, send it back. Omit label or color to keep the current ones.",
      inputSchema: { deviceType: z.string(), ...deviceInput },
    },
    async ({ deviceType, ...input }) => {
      const current = target.project.customMidiDevices.find((device) => device.type === deviceType);
      if (!current) return fail(`No custom MIDI device with type "${deviceType}". Use list_custom_devices.`);
      return storeMidi("Updated", deviceType, input, current);
    },
  );

  server.registerTool(
    "get_custom_device",
    {
      title: "Get custom device",
      description:
        "A custom instrument's, effect's or MIDI device's full device (label, schema and definition), to read before update_instrument / update_effect / update_midi_device.",
      inputSchema: { deviceType: z.string() },
    },
    async ({ deviceType }) => {
      const instrument = target.project.customInstruments.find((def) => def.type === deviceType);
      if (instrument) return ok(JSON.stringify({ kind: "instrument", ...instrument }, null, 2));
      const effect = target.project.customEffects.find((def) => def.type === deviceType);
      if (effect) return ok(JSON.stringify({ kind: "effect", ...effect }, null, 2));
      const midi = target.project.customMidiDevices.find((def) => def.type === deviceType);
      if (midi) return ok(JSON.stringify({ kind: "midi", ...midi }, null, 2));
      return fail(`No custom device with type "${deviceType}". Use list_custom_devices.`);
    },
  );

  server.registerTool(
    "list_custom_devices",
    {
      title: "List custom devices",
      description:
        "The project's user/AI-authored instruments, effects and MIDI devices. `uses` counts the tracks playing an instrument or the slots holding an effect or MIDI device; one at 0 is safe to remove.",
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
            midiDevices: target.project.customMidiDevices.map(describe),
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
      description: "Delete a custom instrument, effect or MIDI device by its type id (see list_custom_devices).",
      inputSchema: { deviceType: z.string() },
    },
    async ({ deviceType }) => {
      if (target.project.customInstruments.some((def) => def.type === deviceType)) {
        if (!target.send({ type: "removeCustomInstrument", deviceType })) return fail(target.whyNotConnected());
        target.project.removeCustomInstrument(deviceType);
        return ok(`Removed custom instrument ${deviceType}.`);
      }
      if (target.project.customEffects.some((def) => def.type === deviceType)) {
        if (!target.send({ type: "removeCustomEffect", deviceType })) return fail(target.whyNotConnected());
        target.project.removeCustomEffect(deviceType);
        return ok(`Removed custom effect ${deviceType}.`);
      }
      if (target.project.customMidiDevices.some((def) => def.type === deviceType)) {
        if (!target.send({ type: "removeCustomMidiDevice", deviceType })) return fail(target.whyNotConnected());
        target.project.removeCustomMidiDevice(deviceType);
        return ok(`Removed custom MIDI device ${deviceType}.`);
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
        return fail(target.whyNotConnected());
      if (muted !== undefined) target.project.setMuted(r.id, muted);
      if (solo !== undefined) target.project.setSolo(r.id, solo);
      if (volume !== undefined) target.project.setVolume(r.id, volume);
      if (name !== undefined) target.project.renameTrack(r.id, name);
      return ok(`Updated track ${r.id}.`);
    },
  );
}
