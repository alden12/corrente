/**
 * The full check of a definition (INST-36.4), generated from the block catalogue: each node's block,
 * its inputs by name, which are required (audio inputs) and which may be left out (controls), and
 * the range of every number. Then a refine for what reaches across nodes: references that name
 * nothing, params the device doesn't have, and outputs. Each problem is reported against the input
 * it's about, and worded to say what there is instead, since an agent usually reads them.
 *
 * What's left for the compiler is what needs the graph worked out: which section each node runs in,
 * and what each section may read.
 */
import { z } from "zod";
import { CATALOGUE, type BlockSpec, type Port } from "./catalogue";
import {
  definitionSchema,
  NODE_NAME,
  RESERVED_NAMES,
  FIXED_INPUTS,
  SAMPLE_INPUTS,
  sampleBindingSchema,
  singleInputSchema,
  TABLE_INPUTS,
  ZONE_SIGNALS,
  type DeviceDefinition,
  type InputValue,
  type ParamBinding,
  type Synced,
} from "./format";
import type { ParamSchema } from "../params/types";
import {
  beatsOf,
  channelsOf,
  hasVoiceNodes,
  isScaled,
  isSynced,
  listOf,
  referenceTo,
  sampleParamsOf,
  voicesOf,
} from "./references";

const NOT_WIRED = "not wired (every audio input needs a value, a param or a connection)";

/** One input of a block: required for an audio input, with every number in the port's range. */
const portInput = (port: Port, required: boolean) => {
  const input = z
    .union([singleInputSchema, z.array(singleInputSchema).min(1)], {
      error: (issue) => (issue.input === undefined ? NOT_WIRED : undefined),
    })
    .superRefine((value, context) =>
      listOf(value).forEach((item, index) => {
        if (typeof item === "number" && (item < port.min || item > port.max))
          context.addIssue({
            code: "custom",
            message: `${item} is outside ${port.min}..${port.max}`,
            path: Array.isArray(value) ? [index] : [],
          });
      }),
    );
  return required ? input : input.optional();
};

const PLAIN_SAMPLE = "takes a sample param as { param }, with no scale, offset or table";

/**
 * An input naming a sample or a wavetable: a sample param as it is (the bank turns it into a slot),
 * or for a sampler, `voice.sample`, the sample of the zone each note took (checked against the zones
 * later). Always wanted.
 */
const sampleInput = (what: "sample" | "wavetable", zoned: boolean) =>
  z.unknown().superRefine((value, context) => {
    if (value === undefined)
      context.addIssue({ code: "custom", message: `needs a sample param (which ${what} it plays)` });
    else if (!(zoned && value === "voice.sample") && !sampleBindingSchema.safeParse(value).success)
      context.addIssue({ code: "custom", message: PLAIN_SAMPLE });
  });

/** A control read once, when the device loads: a plain number in its range. */
const fixedInput = (port: Port) =>
  z
    .number({ error: "takes a number: it's set once, when the device loads" })
    .min(port.min, `${port.min} is the least it takes`)
    .max(port.max, `${port.max} is the most it takes`)
    .optional();

/** The schema for each of a block's inputs, by name. */
const inputsOf = (block: BlockSpec) => {
  const has = (inputs: Record<string, readonly string[]>, port: Port) => inputs[block.name]?.includes(port.name);
  const schemaOf = (port: Port, required: boolean) => {
    if (has(SAMPLE_INPUTS, port)) return sampleInput("sample", true);
    if (has(TABLE_INPUTS, port)) return sampleInput("wavetable", false);
    if (has(FIXED_INPUTS, port)) return fixedInput(port);
    return portInput(port, required);
  };
  return Object.fromEntries([
    ...block.inputs.map((port) => [port.name, schemaOf(port, true)]),
    ...block.controls.map((port) => [port.name, schemaOf(port, false)]),
  ]);
};

/** A node of one block: `inputs` holds exactly that block's inputs. */
const nodeOf = (block: BlockSpec) => {
  const names = [...block.inputs, ...block.controls].map((port) => port.name).join(", ") || "none";
  const inputs = z
    .strictObject(inputsOf(block), {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `a ${block.name} has no input ${issue.keys.map((key) => `"${key}"`).join(", ")} (it has ${names})`
          : undefined,
    })
    // Left out, it's no inputs, so each audio input is reported as not wired.
    .prefault({});
  return z.strictObject(
    { block: z.literal(block.name), voice: z.boolean().optional(), inputs },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `a node has no ${issue.keys.map((key) => `"${key}"`).join(", ")} (it has block, voice and inputs)`
          : undefined,
    },
  );
};

const nodeSchema = z.discriminatedUnion(
  "block",
  CATALOGUE.blocks.map(nodeOf) as unknown as [ReturnType<typeof nodeOf>, ...ReturnType<typeof nodeOf>[]],
  {
    error: (issue) =>
      issue.code === "invalid_union"
        ? `there is no block "${(issue.input as { block?: unknown } | undefined)?.block}"`
        : undefined,
  },
);

const nodeName = z
  .string()
  .regex(NODE_NAME, "node names are a letter then letters, digits and _")
  .refine((name) => !RESERVED_NAMES.includes(name), `the name is kept for signals (${RESERVED_NAMES.join(", ")})`);

/** References and params across the definition, each reported against where it's written. */
const checkAcross = (definition: DeviceDefinition, params: ParamSchema | undefined, context: z.RefinementCtx) => {
  const problem = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  const { nodes } = definition;

  /** A param binding's param, which must be the device's and something that reads as a number. */
  const checkParam = (binding: ParamBinding, path: (string | number)[]) => {
    if (!params) return undefined;
    const spec = params.find((candidate) => candidate.id === binding.param);
    if (!spec) {
      const names = params.map((candidate) => candidate.id).join(", ") || "none";
      problem(path, `there is no param "${binding.param}" (the device has ${names})`);
    } else if (spec.kind === "sample") {
      problem(path, `${binding.param} is a sample param, which only feeds a sampler's sample or a wavetable's table`);
    }
    return spec;
  };

  /** A sample param, as a sample input or a zone names it: one the device has, of the sample kind. */
  const checkSampleParam = (binding: ParamBinding, path: (string | number)[]) => {
    const spec = params?.find((candidate) => candidate.id === binding.param);
    if (params && !spec) checkParam(binding, path);
    else if (spec && spec.kind !== "sample") problem(path, `${binding.param} is a ${spec.kind} param, not a sample`);
  };

  /** A zone signal read in a definition with no zones, which would always read 0. */
  const checkZoneSignal = (reference: string, path: (string | number)[]) => {
    if (!definition.zones && (ZONE_SIGNALS as readonly string[]).includes(reference))
      problem(path, `${reference} is the sample zone a note took, and there are no zones`);
  };

  /** A tempo-synced length's beats: a note division, or a param that can be read as one. */
  const checkSynced = (item: Synced, path: (string | number)[]) => {
    const { beats } = item;
    if (typeof beats === "number") return;
    if (typeof beats === "string") {
      if (beatsOf(beats) === undefined)
        problem(path, `"${beats}" is not a note division (try "1/8", "1/8T" or "1/8.")`);
      return;
    }
    const spec = checkParam(beats, path);
    if (spec?.kind === "enum") {
      const odd = spec.options.filter((option) => beatsOf(option) === undefined);
      if (odd.length > 0)
        problem(path, `${beats.param}'s options must be note divisions ("1/8", "1/8T"), not ${odd.join(", ")}`);
    } else if (spec && item.as === "hz") {
      problem(path, `a rate in hz needs ${beats.param} as a choice of note divisions, not a number of beats`);
    }
  };

  Object.entries(nodes).forEach(([name, node]) =>
    Object.entries(node.inputs ?? {}).forEach(([port, value]: [string, InputValue]) => {
      const inputPath = ["nodes", name, "inputs", port];
      // Its shape is the node schema's: a sample param, or voice.sample for a sampler.
      if (SAMPLE_INPUTS[node.block]?.includes(port) || TABLE_INPUTS[node.block]?.includes(port)) {
        if (typeof value === "object" && !Array.isArray(value) && "param" in value) checkSampleParam(value, inputPath);
        else if (value === "voice.sample" && SAMPLE_INPUTS[node.block]?.includes(port))
          checkZoneSignal(value, inputPath);
        return;
      }
      if (FIXED_INPUTS[node.block]?.includes(port)) return;
      listOf(value).forEach((item, index) => {
        const path = ["nodes", name, "inputs", port, ...(Array.isArray(value) ? [index] : [])];
        if (typeof item === "number") return;
        if (typeof item === "string" || isScaled(item)) {
          const reference = typeof item === "string" ? item : item.from;
          const source = referenceTo(reference, nodes);
          if (typeof source === "string") problem(path, source);
          checkZoneSignal(reference, path);
          if (typeof item !== "string") {
            [item.scale, item.offset].forEach((amount) => {
              if (typeof amount === "object") checkParam(amount, path);
            });
          }
          return;
        }
        if (isSynced(item)) checkSynced(item, path);
        else checkParam(item, path);
      });
    }),
  );
  // A param is cut into wavetable cycles or played as a sample, so it can't feed both.
  new Set(sampleParamsOf(definition).both).forEach((param) =>
    problem(["nodes"], `${param} feeds both a sample and a wavetable; give each its own param`),
  );

  definition.zones?.forEach((zone, index) => {
    checkSampleParam(zone.sample, ["zones", index, "sample"]);
    // Settings read from params, which must be the device's and read as numbers.
    (["root", "start", "end", "trimStart", "trimEnd", "tune", "level", "keytrack"] as const).forEach((setting) => {
      const value = zone[setting];
      if (typeof value === "object") checkParam(value, ["zones", index, setting]);
    });
    zone.keys?.forEach((key, end) => typeof key === "object" && checkParam(key, ["zones", index, "keys", end]));
    const [low, high] = zone.keys ?? [];
    if (typeof low === "number" && typeof high === "number" && low > high)
      problem(["zones", index, "keys"], "the lowest key comes first");
    if (zone.velocities && zone.velocities[0] > zone.velocities[1])
      problem(["zones", index, "velocities"], "the lowest velocity comes first");
  });

  channelsOf(definition.voice).forEach((reference) => {
    const source = referenceTo(reference, nodes);
    if (typeof source === "string") problem(["voice"], source);
    else if (source.type !== "node" || !nodes[source.name].voice)
      problem(["voice"], "each voice plays a voice node's output");
  });
  channelsOf(definition.output).forEach((reference) => {
    const source = referenceTo(reference, nodes);
    if (typeof source === "string") problem(["output"], source);
  });

  const voices = voicesOf(definition);
  const voiced = hasVoiceNodes(definition);
  if (voiced && definition.voice === undefined)
    problem(["voice"], "the voices play nothing (name what each voice plays)");
  if (voiced && voices === 0) problem(["voices"], "there are voice nodes but no voices");
  if (!voiced && definition.voice !== undefined) problem(["voice"], "there are no voice nodes to play");
  if (definition.output === undefined && voices === 0) problem(["output"], "the track plays nothing (name its output)");
};

/**
 * The schema a definition must pass to compile. With `params` (the device's param schema), a binding
 * to any other param, or to one that can't be a number (a sample), is a problem.
 */
export const definitionSchemaFor = (params?: ParamSchema) =>
  definitionSchema
    .extend({ nodes: z.record(nodeName, nodeSchema) })
    .superRefine((definition, context) => checkAcross(definition as DeviceDefinition, params, context));

/**
 * Where a problem is, as people write it: `osc.frequency` for an input, `osc` for the rest of a node,
 * `zones[2].keys` for part of a zone, the field's name otherwise.
 */
const whereOf = (path: readonly PropertyKey[]): string => {
  const [field, name, part, port] = path.map(String);
  if (field === "nodes" && name !== undefined)
    return part === "inputs" && port !== undefined ? `${name}.${port}` : name;
  if (field === "zones" && name !== undefined) return `zones[${name}]${part === undefined ? "" : `.${part}`}`;
  return field ?? "the definition";
};

/** A failed check's problems as `where: what` lines. A bad node name's own message is inside its issue. */
export const problemsIn = (error: z.ZodError): string[] =>
  error.issues.map((issue) => {
    const message = issue.code === "invalid_key" ? (issue.issues[0]?.message ?? issue.message) : issue.message;
    return `${whereOf(issue.path)}: ${message}`;
  });
