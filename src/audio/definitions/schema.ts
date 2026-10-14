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
  channelsSchema,
  DEFAULT_VOICES,
  DEFINITION_FORMAT,
  MAX_VOICES,
  NODE_NAME,
  RESERVED_NAMES,
  SAMPLE_INPUTS,
  singleInputSchema,
  type DeviceDefinition,
  type InputValue,
  type ParamBinding,
  type Synced,
} from "./format";
import type { ParamSchema } from "../params/types";
import { beatsOf, channelsOf, isScaled, isSynced, listOf, referenceTo } from "./references";

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

/** A node of one block: `inputs` holds exactly that block's inputs. */
const nodeOf = (block: BlockSpec) => {
  const names = [...block.inputs, ...block.controls].map((port) => port.name).join(", ") || "none";
  const inputs = z
    .strictObject(
      Object.fromEntries([
        ...block.inputs.map((port) => [port.name, portInput(port, true)]),
        ...block.controls.map((port) => [port.name, portInput(port, false)]),
      ]),
      {
        error: (issue) =>
          issue.code === "unrecognized_keys"
            ? `a ${block.name} has no input ${issue.keys.map((key) => `"${key}"`).join(", ")} (it has ${names})`
            : undefined,
      },
    )
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
      problem(path, `${binding.param} is a sample param, which only feeds a sampler's sample`);
    }
    return spec;
  };

  /** An input that names a sample: a sample param, as it is (the bank turns it into a slot). */
  const checkSampleInput = (value: InputValue, path: (string | number)[]) => {
    const plain =
      typeof value === "object" && !Array.isArray(value) && "param" in value && Object.keys(value).length === 1;
    if (!plain) return problem(path, "takes a sample param as { param }, with no scale, offset or table");
    const spec = params?.find((candidate) => candidate.id === value.param);
    if (params && !spec) checkParam(value, path);
    else if (spec && spec.kind !== "sample") problem(path, `${value.param} is a ${spec.kind} param, not a sample`);
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
      if (SAMPLE_INPUTS[node.block]?.includes(port)) return checkSampleInput(value, ["nodes", name, "inputs", port]);
      listOf(value).forEach((item, index) => {
        const path = ["nodes", name, "inputs", port, ...(Array.isArray(value) ? [index] : [])];
        if (typeof item === "number") return;
        if (typeof item === "string" || isScaled(item)) {
          const source = referenceTo(typeof item === "string" ? item : item.from, nodes);
          if (typeof source === "string") problem(path, source);
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
  Object.entries(nodes).forEach(([name, node]) =>
    (SAMPLE_INPUTS[node.block] ?? [])
      .filter((port) => node.inputs?.[port] === undefined)
      .forEach((port) => problem(["nodes", name, "inputs", port], "needs a sample param (which sample it plays)")),
  );

  const voiceNodes = Object.keys(nodes).filter((name) => nodes[name].voice);
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

  const voices = definition.voices ?? (voiceNodes.length > 0 ? DEFAULT_VOICES : 0);
  if (voiceNodes.length > 0 && definition.voice === undefined)
    problem(["voice"], "the voices play nothing (name what each voice plays)");
  if (voiceNodes.length > 0 && voices === 0) problem(["voices"], "there are voice nodes but no voices");
  if (voiceNodes.length === 0 && definition.voice !== undefined) problem(["voice"], "there are no voice nodes to play");
  if (definition.output === undefined && voices === 0) problem(["output"], "the track plays nothing (name its output)");
};

/**
 * The schema a definition must pass to compile. With `params` (the device's param schema), a binding
 * to any other param, or to one that can't be a number (a sample), is a problem.
 */
export const definitionSchemaFor = (params?: ParamSchema) =>
  z
    .strictObject({
      format: z.literal(DEFINITION_FORMAT),
      voices: z.number().int().min(0).max(MAX_VOICES).optional(),
      latency: z.number().int().min(0).optional(),
      nodes: z.record(nodeName, nodeSchema),
      voice: channelsSchema.optional(),
      output: channelsSchema.optional(),
    })
    .superRefine((definition, context) => checkAcross(definition as DeviceDefinition, params, context));

/**
 * Where a problem is, as people write it: `osc.frequency` for an input, `osc` for the rest of a node,
 * the field's name otherwise.
 */
const whereOf = (path: readonly PropertyKey[]): string => {
  const [field, name, part, port] = path.map(String);
  if (field === "nodes" && name !== undefined)
    return part === "inputs" && port !== undefined ? `${name}.${port}` : name;
  return field ?? "the definition";
};

/** A failed check's problems as `where: what` lines. A bad node name's own message is inside its issue. */
export const problemsIn = (error: z.ZodError): string[] =>
  error.issues.map((issue) => {
    const message = issue.code === "invalid_key" ? (issue.issues[0]?.message ?? issue.message) : issue.message;
    return `${whereOf(issue.path)}: ${message}`;
  });
