/**
 * The device definition format (INST-36.4): a device as data, for the new engine. Blocks from the
 * catalogue (engine/catalogue.json), each input wired by name, compiled to a plan by compile.ts.
 * DOM-free, so the app and both MCP servers share it.
 *
 *   {
 *     "format": 1,
 *     "voices": 8,
 *     "nodes": {
 *       "osc": { "block": "saw", "voice": true, "inputs": { "frequency": "voice.frequency" } },
 *       "env": { "block": "adsr", "voice": true, "inputs": { "gate": "voice.gate", "release": { "param": "release" } } },
 *       "vca": { "block": "mul", "voice": true, "inputs": { "a": "osc", "b": "env" } },
 *       "verb": { "block": "reverb", "inputs": { "left": "voices.left", "right": "voices.right" } }
 *     },
 *     "voice": "vca",
 *     "output": ["verb.left", "verb.right"]
 *   }
 *
 * - **Nodes** are blocks by name. A node marked `voice` runs once per sounding voice; the rest run
 *   once for the track, before the voices (an LFO they share) or after them (effects on the voices
 *   summed): which, the compiler works out from what each reads.
 * - **Each input** is a number, a param binding, a reference, or a list of those, which are summed.
 *   A reference is a node (`"osc"`, its first output) or one of its outputs (`"svf.highpass"`), or a
 *   signal: `voice.frequency`, `voice.gate`, `voice.velocity` (in voice nodes), `voices.left` and
 *   `voices.right` (the voices summed, after them), `input.left`, `input.right`,
 *   `input.sidechainLeft`, `input.sidechainRight` (the track's audio in).
 * - **Every audio input must be wired**; a control (a block's slider) left out keeps its starting
 *   value. Feedback is allowed: loops are found and run a sample at a time, or in chunks when every
 *   path round them passes through a `delay`.
 * - **`voice`** is what each voice plays (one output, or two for left and right), and **`output`**
 *   what the track plays: the voices summed unless it says otherwise.
 */
import { z } from "zod";

/** The format's version. A change that old definitions can't be read under bumps it, with an upcaster. */
export const DEFINITION_FORMAT = 1;

/** The per-voice signals, by the index the engine numbers them (engine/src/plan/mod.rs). */
export const VOICE_SIGNALS = { "voice.frequency": 0, "voice.gate": 1, "voice.velocity": 2 } as const;
/** The voices summed, by channel. */
export const VOICE_SUM = { "voices.left": 0, "voices.right": 1 } as const;
/** The track's audio inputs, by channel. */
export const TRACK_INPUTS = {
  "input.left": 0,
  "input.right": 1,
  "input.sidechainLeft": 2,
  "input.sidechainRight": 3,
} as const;
/** The most voices a track may have (the engine's MAX_VOICES). */
export const MAX_VOICES = 64;
/** Voices a device with voice nodes gets when it doesn't say. */
export const DEFAULT_VOICES = 8;

/**
 * A param read into an input: its value (looked up in `table` first, if there is one: straight
 * lines between the points) times `scale` plus `offset`. The same shape as today's graph format.
 */
export const paramBindingSchema = z
  .object({
    param: z.string().min(1),
    scale: z.number().finite().optional(),
    offset: z.number().finite().optional(),
    table: z
      .array(z.tuple([z.number().finite(), z.number().finite()]))
      .min(2)
      .optional(),
  })
  .strict();

const singleInputSchema = z.union([z.number().finite(), z.string().min(1), paramBindingSchema]);
/** One input: a number, a param binding, a reference, or several of those summed. */
export const inputSchema = z.union([singleInputSchema, z.array(singleInputSchema).min(1)]);

/** Node names are plain words: they're written into references (`node.port`), so no dots. */
const NODE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Words a node can't be named, since references starting with them are signals. */
export const RESERVED_NAMES = ["voice", "voices", "input"];

export const nodeSchema = z
  .object({
    block: z.string().min(1),
    voice: z.boolean().optional(),
    inputs: z.record(z.string(), inputSchema).optional(),
  })
  .strict();

/** One reference (mono, or in both channels), or a left and a right. */
const channelsSchema = z.union([z.string().min(1), z.tuple([z.string().min(1), z.string().min(1)])]);

export const definitionSchema = z
  .object({
    format: z.literal(DEFINITION_FORMAT),
    voices: z.number().int().min(0).max(MAX_VOICES).optional(),
    /** How many samples late the output runs (a look-ahead), for the mixer to make up. */
    latency: z.number().int().min(0).optional(),
    nodes: z.record(z.string().regex(NODE_NAME, "node names are a letter then letters, digits and _"), nodeSchema),
    voice: channelsSchema.optional(),
    output: channelsSchema.optional(),
  })
  .strict();

export type ParamBinding = z.infer<typeof paramBindingSchema>;
export type InputValue = z.infer<typeof inputSchema>;
export type DefinitionNode = z.infer<typeof nodeSchema>;
export type DeviceDefinition = z.infer<typeof definitionSchema>;
