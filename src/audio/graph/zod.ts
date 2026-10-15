/**
 * Runtime validation for declarative device definitions - the boundary gate for
 * untrusted input (a shared project file, or an MCP `create_*` call). zod schemas
 * mirror the TS types in types.ts (the specToZod convention), and `validateGraph`
 * adds the semantic checks zod can't express (param refs resolve, connections wire to
 * real nodes/params). DOM-free, so the Node MCP server validates with the same code.
 *
 * `parseInstrumentDef` / `parseEffectDef` validate a single def and return its errors.
 * Custom devices are no longer in this format (definitions/custom.ts); it goes with the
 * old engine (INST-36.8 part 6).
 */
import { z } from "zod";
import { paramSchemaSchema } from "../params/declaration";
import { issueLines } from "../../util";
import type { ParamSchema } from "../params/types";
import { ANALOG_WAVEFORMS, IMPULSE_SHAPES, NOISE_COLORS, SHAPER_SHAPES, WAVETABLE_BANKS } from "./types";
import type { Graph, GraphInstrumentDef, GraphEffectDef } from "./types";
import { validateGraph, INSTRUMENT_RESERVED, EFFECT_RESERVED } from "./validate";
import { tableProblem } from "./table";

const paramRef = z.object({ param: z.string(), scale: z.number().optional(), offset: z.number().optional() }).strict();
const table = z.array(z.tuple([z.number(), z.number()])).superRefine((points, issues) => {
  const problem = tableProblem(points);
  if (problem) issues.addIssue({ code: "custom", message: problem });
});
// Only a number can be read off a table; an enum or a switch binds its param as it is.
const numberRef = z
  .object({ param: z.string(), table: table.optional(), scale: z.number().optional(), offset: z.number().optional() })
  .strict();
const numberField = z.union([z.number(), numberRef]);
const enumField = z.union([z.string(), paramRef]);
const boolField = z.union([z.boolean(), paramRef]);

const nodeSpec = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string(),
      kind: z.literal("osc"),
      waveform: enumField.optional(),
      frequency: numberField.optional(),
      noteRatio: numberField.optional(),
      detune: numberField.optional(),
    })
    .strict(),
  z.object({ id: z.string(), kind: z.literal("gain"), gain: numberField.optional() }).strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("biquad"),
      filterType: z.string().optional(),
      frequency: numberField.optional(),
      q: numberField.optional(),
      gain: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("delay"),
      maxSeconds: z.number().optional(),
      delayTime: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("shaper"),
      oversample: z.string().optional(),
      curve: z.object({ shape: z.enum(SHAPER_SHAPES), amount: numberField }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("env"),
      attack: numberField.optional(),
      decay: numberField.optional(),
      sustain: numberField.optional(),
      release: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("buffer"),
      sample: enumField,
      note: numberField.optional(),
      root: numberField.optional(),
      keytrack: boolField.optional(),
      detune: numberField.optional(),
      oneShot: boolField.optional(),
      start: numberField.optional(),
      trimEnd: numberField.optional(),
    })
    .strict(),
  z.object({ id: z.string(), kind: z.literal("noise"), color: z.enum(NOISE_COLORS).optional() }).strict(),
  z.object({ id: z.string(), kind: z.literal("constant"), offset: numberField.optional() }).strict(),
  z.object({ id: z.string(), kind: z.literal("pan"), pan: numberField.optional() }).strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("compressor"),
      threshold: numberField.optional(),
      knee: numberField.optional(),
      ratio: numberField.optional(),
      attack: numberField.optional(),
      release: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("convolver"),
      impulse: z.object({ shape: z.enum(IMPULSE_SHAPES), seconds: numberField }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("wavetableOsc"),
      bank: z.union([z.enum(WAVETABLE_BANKS), paramRef]).optional(),
      position: numberField.optional(),
      frequency: numberField.optional(),
      noteRatio: numberField.optional(),
      detune: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("analogOsc"),
      waveform: z.union([z.enum(ANALOG_WAVEFORMS), paramRef]).optional(),
      frequency: numberField.optional(),
      noteRatio: numberField.optional(),
      detune: numberField.optional(),
      pulseWidth: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("ladder"),
      frequency: numberField.optional(),
      resonance: numberField.optional(),
      detune: numberField.optional(),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      kind: z.literal("bitcrush"),
      bits: numberField.optional(),
      downsample: numberField.optional(),
    })
    .strict(),
]);

const graph = z.object({ nodes: z.array(nodeSpec), connections: z.array(z.tuple([z.string(), z.string()])) }).strict();

const paramSchema = paramSchemaSchema;

export const instrumentDefSchema = z
  .object({ type: z.string(), label: z.string().optional(), schema: paramSchema, voice: graph })
  .strict();
export const effectDefSchema = z
  .object({ type: z.string(), label: z.string().optional(), schema: paramSchema, graph: graph })
  .strict();

export type DefResult<T> = { ok: true; def: T } | { ok: false; errors: string[] };

export function parseInstrumentDef(raw: unknown): DefResult<GraphInstrumentDef> {
  const parsed = instrumentDefSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: issueLines(parsed.error) };
  const semantic = validateGraph(parsed.data.schema as ParamSchema, parsed.data.voice as Graph, INSTRUMENT_RESERVED);
  if (semantic.length) return { ok: false, errors: semantic };
  return { ok: true, def: parsed.data as GraphInstrumentDef };
}

export function parseEffectDef(raw: unknown): DefResult<GraphEffectDef> {
  const parsed = effectDefSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: issueLines(parsed.error) };
  const semantic = validateGraph(parsed.data.schema as ParamSchema, parsed.data.graph as Graph, EFFECT_RESERVED);
  if (semantic.length) return { ok: false, errors: semantic };
  return { ok: true, def: parsed.data as GraphEffectDef };
}
