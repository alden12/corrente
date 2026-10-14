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
 * - **Each input** is a number, a param binding, a reference, a scaled reference, a tempo-synced
 *   length, or a list of those, which are summed.
 *   - A **param binding** reads a number param as it is, a switch as 0 or 1, and a choice (an enum)
 *     as its option's index, 0 first.
 *   - A **reference** is a node (`"osc"`, its first output), one of its outputs (`"svf.highpass"`),
 *     or a signal: `voice.frequency`, `voice.gate`, `voice.velocity`, `voice.note`, `voice.seed` (in
 *     voice nodes); `voices.left` and `voices.right` (the voices summed, after them); `input.left`,
 *     `input.right`, `input.sidechainLeft`, `input.sidechainRight` (the track's audio in);
 *     `host.tempo`, `host.beat`, `host.playing`, `host.beatSeconds`, `host.beatSamples` (anywhere).
 *   - A **scaled reference**, `{ "from": "lfo.sine", "scale": 12, "offset": 0 }`, is a reference
 *     times `scale` plus `offset`, each a number or a param: an LFO's -1..1 sweeps a knob's worth of
 *     semitones with no `mul` node.
 *   - A **tempo-synced length**, `{ "beats": "1/8", "as": "hz" }`, follows the tempo: a note
 *     division, a number of beats, or a param, as a rate in Hz, a length in seconds or samples, or
 *     the beats themselves.
 * - **Every audio input must be wired**; a control (a block's slider) left out keeps its starting
 *   value. Feedback is allowed: loops are found and run a sample at a time, or in chunks when every
 *   path round them passes through a `delay`.
 * - **`voice`** is what each voice plays (one output, or two for left and right), and **`output`**
 *   what the track plays: the voices summed unless it says otherwise.
 */
import { z } from "zod";

/** The format's version. A change that old definitions can't be read under bumps it, with an upcaster. */
export const DEFINITION_FORMAT = 1;

/**
 * The per-voice signals, by the index the engine numbers them (engine/src/plan/mod.rs): the note's
 * frequency, gate (1 while held), velocity (0 to 1), note number (MIDI, 60 is middle C) and seed (a
 * random number from 0 to 1 drawn at each note on, for drift and variation).
 */
export const VOICE_SIGNALS = {
  "voice.frequency": 0,
  "voice.gate": 1,
  "voice.velocity": 2,
  "voice.note": 3,
  "voice.seed": 4,
} as const;
/**
 * The host's signals, the same for every track and readable anywhere: the tempo (beats a minute),
 * the beat (counted from where the transport started, running on while it's stopped), playing (0 or
 * 1), and a beat's length in seconds and in samples.
 */
export const HOST_SIGNALS = {
  "host.tempo": 0,
  "host.beat": 1,
  "host.playing": 2,
  "host.beatSeconds": 3,
  "host.beatSamples": 4,
} as const;
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

/** A number, or a param's value: what a scaled reference is scaled or offset by. */
const amountSchema = z.union([z.number().finite(), paramBindingSchema]);

/** A reference times `scale` plus `offset` (defaults 1 and 0), each a number or a param. */
export const scaledReferenceSchema = z
  .object({
    from: z.string().min(1),
    scale: amountSchema.optional(),
    offset: amountSchema.optional(),
  })
  .strict();

/**
 * What a tempo-synced input is wanted in: a rate (an LFO's), a length (a delay's), or the number of
 * beats itself (a beatlfo's cycle length).
 */
export const SYNC_UNITS = ["hz", "seconds", "samples", "beats"] as const;

/**
 * A length in beats, kept in time with the tempo: a note division (`"1/8"`, `"1/8T"` a triplet,
 * `"1/8."` dotted, `"2/1"` two bars of 4/4), a number of beats, or a param (a number of beats, or a
 * choice of divisions), given `as` a rate in Hz (one cycle per that length) or a length in seconds or
 * samples, or as the number of beats itself.
 */
export const syncedSchema = z
  .object({
    beats: z.union([z.string().min(1), z.number().positive().finite(), paramBindingSchema]),
    as: z.enum(SYNC_UNITS),
  })
  .strict();

export const singleInputSchema = z.union([
  z.number().finite(),
  z.string().min(1),
  paramBindingSchema,
  scaledReferenceSchema,
  syncedSchema,
]);
/**
 * One input: a number, a param binding, a reference, a scaled reference, a tempo-synced length, or
 * several of those summed.
 */
export const inputSchema = z.union([singleInputSchema, z.array(singleInputSchema).min(1)]);

/** Node names are plain words: they're written into references (`node.port`), so no dots. */
export const NODE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Words a node can't be named, since references starting with them are signals. */
export const RESERVED_NAMES = ["voice", "voices", "input", "host"];

/**
 * Inputs that name a sample (INST-36.6), by block: each takes a sample param, plainly, and a sample
 * param feeds nothing else. The engine reads a slot; the bank puts the sample the param names in one.
 */
export const SAMPLE_INPUTS: Record<string, readonly string[]> = { sampler: ["sample"] };

export const nodeSchema = z
  .object({
    block: z.string().min(1),
    voice: z.boolean().optional(),
    inputs: z.record(z.string(), inputSchema).optional(),
  })
  .strict();

/** One reference (mono, or in both channels), or a left and a right. */
export const channelsSchema = z.union([z.string().min(1), z.tuple([z.string().min(1), z.string().min(1)])]);

/**
 * The format's shape, with any block name and any inputs: what a definition's type comes from, and
 * the outline a tool's input can show. `definitionSchemaFor` (schema.ts) is the full check.
 */
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
export type ScaledReference = z.infer<typeof scaledReferenceSchema>;
export type Synced = z.infer<typeof syncedSchema>;
export type InputValue = z.infer<typeof inputSchema>;
export type DefinitionNode = z.infer<typeof nodeSchema>;
export type DeviceDefinition = z.infer<typeof definitionSchema>;
