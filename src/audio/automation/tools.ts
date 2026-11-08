/**
 * The automation tools (DAW-67.3), defined once for both the in-app agent and the MCP server, so
 * their names, descriptions and argument shapes can't drift apart (AGENT-6). Each surface wraps them
 * its own way: the agent dispatches the command, the MCP server sends it to the tab and mirrors it.
 *
 * A tool reads the project and returns a reply, and an edit tool returns the command too. Every
 * default (a new clip's name and length) is resolved here, so the command is the same on both ends.
 * Errors are thrown with a message saying what to call instead, which each surface relays.
 *
 * Plain text everywhere a model reads: no ticket refs (working rules).
 */
import { z } from "zod";
import type { ProjectStore, Track } from "../project/projectStore";
import type { ProtocolEdit } from "../commands/types";
import type { AutomationBinding, AutomationPoint } from "../project/types";
import { AUTOMATION_SHAPES } from "../project/schema";
import { newAutomationBindingId, newAutomationId, newAutomationPointId, newPlacementId } from "../commands/ids";
import { issueLines } from "../../util";

export interface AutomationTool {
  name: string;
  title: string;
  description: string;
  /** The arguments besides the track, which each surface adds its own way. */
  input: z.ZodRawShape;
  run(project: ProjectStore, track: Track, args: unknown): { reply: unknown; command?: ProtocolEdit };
}

function automationTool<Shape extends z.ZodRawShape>(def: {
  name: string;
  title: string;
  description: string;
  input: Shape;
  run(
    project: ProjectStore,
    track: Track,
    args: z.infer<z.ZodObject<Shape>>,
  ): { reply: unknown; command?: ProtocolEdit };
}): AutomationTool {
  const schema = z.object(def.input);
  return {
    ...def,
    run: (project, track, args) => {
      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) throw new Error(`Invalid arguments: ${issueLines(parsed.error).join("; ")}`);
      return def.run(project, track, parsed.data);
    },
  };
}

const pointInput = z.object({
  beat: z.number().min(0).describe("from the clip's start, in beats"),
  value: z.number().min(0).max(1).describe("0..1, mapped into each knob's min..max"),
  shape: z
    .enum(AUTOMATION_SHAPES)
    .optional()
    .describe(
      "the segment from this point to the next: curve (default, a line bent by `bend`), step (hold, then jump), or a wave repeating every `rate` beats around the line, `depth` either side",
    ),
  bend: z
    .number()
    .min(-1)
    .max(1)
    .optional()
    .describe("a curve's bend: positive rises fast then eases, negative the reverse"),
  rate: z.number().positive().optional().describe("a wave's cycle in beats (0.25 = a sixteenth note); default 1"),
  depth: z.number().min(0).max(1).optional().describe("a wave's swing either side of its line, 0..1; default 0.25"),
});

const bindingInput = z.object({
  device: z
    .string()
    .describe('"instrument" for the track\'s instrument, or the id of one of its effects (see list_effects)'),
  param: z.string().describe("the knob's param id (see list_parameters or list_effect_parameters)"),
  min: z.number().optional().describe("the knob's value at curve 0, in its own units; default its minimum"),
  max: z.number().optional().describe("the knob's value at curve 1; default its maximum. Below min inverts it"),
});

const pointsArg = z.array(pointInput).max(512).describe("the whole curve, replacing any it had");
const bindingsArg = z.array(bindingInput).max(16).describe("every knob it drives, replacing any it had");

const points = (input: z.infer<typeof pointInput>[]): AutomationPoint[] =>
  input.map((point) => ({ id: newAutomationPointId(), ...point }));

/** The track's knob a binding names, checked: a number param on its instrument or one of its effects. */
function binding(track: Track, input: z.infer<typeof bindingInput>): AutomationBinding {
  const target =
    input.device === "instrument"
      ? ({ kind: "instrument" } as const)
      : ({ kind: "effect", effectId: input.device } as const);
  const store =
    target.kind === "instrument"
      ? track.kind === "instrument"
        ? track.params
        : undefined
      : track.effects.find((effect) => effect.id === target.effectId)?.params;
  if (!store) {
    if (track.kind === "instrument" && track.midiDevices.some((device) => device.id === input.device))
      throw new Error(`MIDI device knobs can't be automated yet; automate the instrument's or an effect's.`);
    throw new Error(
      target.kind === "instrument"
        ? `Track "${track.id}" is an audio track, so it has no instrument: automate one of its effects.`
        : `No effect "${input.device}" on track "${track.id}". Call list_effects for its chain.`,
    );
  }
  if (!store.has(input.param))
    throw new Error(`No param "${input.param}" on ${input.device}. Call list_parameters for its knobs.`);
  const spec = store.spec(input.param);
  if (spec.kind !== "number")
    throw new Error(`"${input.param}" is a ${spec.kind} param, not a number knob, so it can't be automated.`);
  return {
    id: newAutomationBindingId(),
    target,
    param: input.param,
    min: input.min ?? spec.min,
    max: input.max ?? spec.max,
  };
}

function automationOf(track: Track, id: string) {
  const clip = track.automations.find((automation) => automation.id === id);
  if (!clip) throw new Error(`No automation "${id}" on track "${track.id}". Call list_automation.`);
  return clip;
}

function noteClip(track: Track, id: string): string {
  if (track.kind !== "instrument" || !track.clips.some((clip) => clip.id === id))
    throw new Error(`No note clip "${id}" on track "${track.id}" to link to. Call list_clips.`);
  return id;
}

/** A binding as a tool reads it back: the device as it was named. */
const bindingReply = (binding: AutomationBinding) => ({
  device:
    binding.target.kind === "instrument"
      ? "instrument"
      : binding.target.kind === "effect"
        ? binding.target.effectId
        : binding.target.deviceId,
  param: binding.param,
  min: binding.min,
  max: binding.max,
});

export const AUTOMATION_TOOLS: AutomationTool[] = [
  automationTool({
    name: "list_automation",
    title: "List automation",
    description:
      "Return a track's automation clips: each one's curve (points, beats from the clip's start, values 0..1), the knobs it drives with their ranges, and where it plays (its placements on the timeline, or the note clip it's linked to).",
    input: {},
    run: (_project, track) => ({
      reply: {
        track: track.id,
        automations: track.automations.map((clip) => ({
          id: clip.id,
          name: clip.name,
          lengthBeats: clip.lengthBeats,
          ...(clip.linkedClipId ? { linkedClip: clip.linkedClipId } : {}),
          placements: track.automationPlacements
            .filter((placement) => placement.clipId === clip.id)
            .map(({ id, startBeat, length, offset }) => ({ id, startBeat, length, offset })),
          drives: clip.bindings.map(bindingReply),
          points: clip.points.map(({ beat, value, shape, bend, rate, depth }) => ({
            beat,
            value,
            shape,
            bend,
            rate,
            depth,
          })),
        })),
      },
    }),
  }),

  automationTool({
    name: "add_automation",
    title: "Add automation",
    description:
      "Add an automation clip to a track: a curve that moves knobs over time while the song plays, without changing the knobs' own settings. Give it `points` and the knobs it `drives`; then either `start_beat` to place it on the timeline, or `linked_clip` to play it wherever that note clip plays (looping with it). One clip can drive several knobs together. A repeating wave segment (sine, triangle, saw, square) makes an LFO. Returns the new id.",
    input: {
      name: z.string().optional(),
      length_beats: z
        .number()
        .positive()
        .optional()
        .describe("the clip's length, after which it loops; default a new clip's, or its linked clip's"),
      points: pointsArg.optional(),
      drives: bindingsArg.optional(),
      start_beat: z.number().min(0).optional().describe("place it on the timeline here"),
      linked_clip: z.string().optional().describe("a note clip id on the track (see list_clips) to play with"),
    },
    run: (project, track, args) => {
      const id = newAutomationId();
      const linkedClipId = args.linked_clip === undefined ? undefined : noteClip(track, args.linked_clip);
      const placementId = args.start_beat !== undefined && !linkedClipId ? newPlacementId() : undefined;
      const command: ProtocolEdit = {
        type: "addAutomation",
        trackId: track.id,
        id,
        name: args.name ?? project.defaultAutomationName(track.id),
        lengthBeats: args.length_beats ?? project.defaultAutomationLength(track.id, linkedClipId),
        points: points(args.points ?? []),
        bindings: (args.drives ?? []).map((input) => binding(track, input)),
        ...(linkedClipId ? { linkedClipId } : {}),
        ...(placementId ? { placement: { id: placementId, startBeat: args.start_beat! } } : {}),
      };
      const where = linkedClipId
        ? `linked to ${linkedClipId}`
        : placementId
          ? `placed at beat ${args.start_beat}`
          : "not placed yet (place_automation puts it on the timeline)";
      return {
        command,
        reply: { id, ...(placementId ? { placementId } : {}), note: `Added automation ${id}, ${where}.` },
      };
    },
  }),

  automationTool({
    name: "set_automation",
    title: "Change automation",
    description:
      "Change an automation clip: its name, length, whole curve (`points`), the knobs it `drives`, or the note clip it's linked to (`linked_clip`, null to unlink). What you leave out stays as it is. Linking takes it off the timeline.",
    input: {
      automation: z.string().describe("automation id (see list_automation)"),
      name: z.string().optional(),
      length_beats: z.number().positive().optional(),
      points: pointsArg.optional(),
      drives: bindingsArg.optional(),
      linked_clip: z.string().nullable().optional(),
    },
    run: (_project, track, args) => {
      automationOf(track, args.automation);
      const command: ProtocolEdit = {
        type: "setAutomation",
        trackId: track.id,
        automationId: args.automation,
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.length_beats !== undefined ? { lengthBeats: args.length_beats } : {}),
        ...(args.points ? { points: points(args.points) } : {}),
        ...(args.drives ? { bindings: args.drives.map((input) => binding(track, input)) } : {}),
        ...(args.linked_clip !== undefined
          ? { linkedClipId: args.linked_clip === null ? null : noteClip(track, args.linked_clip) }
          : {}),
      };
      return { command, reply: { ok: true, automation: args.automation } };
    },
  }),

  automationTool({
    name: "remove_automation",
    title: "Remove automation",
    description:
      "Remove an automation clip from a track, and every placement of it. The knobs keep their own settings.",
    input: { automation: z.string().describe("automation id (see list_automation)") },
    run: (_project, track, args) => {
      automationOf(track, args.automation);
      return {
        command: { type: "removeAutomation", trackId: track.id, automationId: args.automation },
        reply: { ok: true },
      };
    },
  }),

  automationTool({
    name: "place_automation",
    title: "Place automation",
    description:
      "Put an automation clip on the timeline at `start_beat` (another placement if it has some; placements may overlap, the later-starting wins a knob). `length` longer than the clip loops it; `offset` starts partway in. Unlinks it from a note clip. Returns the placement id.",
    input: {
      automation: z.string().describe("automation id (see list_automation)"),
      start_beat: z.number().min(0),
      length: z.number().positive().optional().describe("beats on the timeline; default the clip's length"),
      offset: z.number().min(0).optional().describe("beats into the clip it starts at"),
    },
    run: (_project, track, args) => {
      automationOf(track, args.automation);
      const id = newPlacementId();
      return {
        command: {
          type: "placeAutomation",
          trackId: track.id,
          id,
          automationId: args.automation,
          startBeat: args.start_beat,
          ...(args.length !== undefined ? { length: args.length } : {}),
          ...(args.offset !== undefined ? { offset: args.offset } : {}),
        },
        reply: { placementId: id },
      };
    },
  }),

  automationTool({
    name: "set_automation_placement",
    title: "Move automation placement",
    description:
      "Move or trim one of a track's automation placements (its `start_beat`, `offset` into the clip, `length`), or take it off the timeline with `remove`. Placement ids are in list_automation.",
    input: {
      placement: z.string(),
      start_beat: z.number().min(0).optional(),
      offset: z.number().min(0).optional(),
      length: z.number().positive().optional(),
      remove: z.boolean().optional().describe("take it off the timeline"),
    },
    run: (_project, track, args) => {
      if (!track.automationPlacements.some((placement) => placement.id === args.placement))
        throw new Error(`No automation placement "${args.placement}" on track "${track.id}". Call list_automation.`);
      const command: ProtocolEdit = args.remove
        ? { type: "removeAutomationPlacement", trackId: track.id, placementId: args.placement }
        : {
            type: "setAutomationPlacement",
            trackId: track.id,
            placementId: args.placement,
            ...(args.start_beat !== undefined ? { startBeat: args.start_beat } : {}),
            ...(args.offset !== undefined ? { offset: args.offset } : {}),
            ...(args.length !== undefined ? { length: args.length } : {}),
          };
      return { command, reply: { ok: true } };
    },
  }),
];
