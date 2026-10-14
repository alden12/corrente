/**
 * A chain of devices as one definition (INST-36.7): an instrument and the effects after it, or a run
 * of effects, composed so they run as one plan on one engine slot rather than a slot each with Web
 * Audio between them. Feedback between devices and sample-accurate timing come with it, and a
 * track costs one slot.
 *
 * - **Each device keeps its own names:** its nodes are prefixed with its key (`fx3_lfo`), its params
 *   namespaced (`fx3.rate`), so two of the same effect don't collide.
 * - **Each effect's input is what comes before it:** `input.left` and `input.right` in an effect
 *   become the previous device's output. The first device of a run of effects keeps the track's input.
 * - **Mix and bypass are params:** after each effect, its output crossfades with its input by its
 *   `mix` param (if its schema has one) times not `bypass`, a switch the chain adds. Moving either
 *   ramps over a block, with no reload. A bypassed effect still runs.
 *
 * Pure and DOM-free: the engines compose, the bank never sees anything but the compiled plan.
 */
import type { ParamSchema, ParamSpec } from "../params/types";
import {
  DEFAULT_VOICES,
  HOST_SIGNALS,
  VOICE_SIGNALS,
  VOICE_SUM,
  type DefinitionNode,
  type DeviceDefinition,
  type InputValue,
  type ParamBinding,
} from "./format";
import { channelsOf, isScaled, isSynced } from "./references";

/** One device in a chain: its key (unique in the chain, e.g. the effect's id), definition and params. */
export interface ChainLink {
  key: string;
  definition: DeviceDefinition;
  schema: ParamSchema;
  /** An effect: its input is what comes before it, and it gets mix and bypass. */
  effect: boolean;
}

/** A chain as one device. */
export interface ComposedChain {
  definition: DeviceDefinition;
  schema: ParamSchema;
  /** Each param of the composed device, by its namespaced id: which link's param it is. */
  params: Record<string, { link: number; param: string }>;
}

/** The param a chain adds to each effect: 1 bypasses it (an underscore, so no schema of its own clashes). */
export const BYPASS = "_bypass";
/** The param an effect's schema carries for its wet/dry, if it has one. */
const MIX = "mix";

/** A link's param, namespaced in the chain. */
export const chainParam = (key: string, param: string) => `${key}.${param}`;

/** A link's node-name prefix: its key made a valid name (letters, digits and _, a letter first). */
const prefixOf = (key: string) => `x${key.replace(/[^A-Za-z0-9]/g, "_")}_`;

/** Signals every device reads as they are: the voice's, the voices summed, and the host's. */
const SHARED_SIGNALS = new Set<string>([
  ...Object.keys(VOICE_SIGNALS),
  ...Object.keys(VOICE_SUM),
  ...Object.keys(HOST_SIGNALS),
]);

/** One input item: a number, a reference, a param, a scaled reference or a synced length. */
type SingleInput = Exclude<InputValue, unknown[]>;

/** An instrument's `voice` (one reference or a left and a right) in the chain's names. */
const renameVoice = (voice: string | [string, string], prefix: string): string | [string, string] => {
  const rename = (reference: string) => (SHARED_SIGNALS.has(reference) ? reference : `${prefix}${reference}`);
  return typeof voice === "string" ? rename(voice) : [rename(voice[0]), rename(voice[1])];
};

/** What a definition plays: its output, or the voices summed if it has voices and doesn't say. */
const outputOf = (definition: DeviceDefinition): string[] => {
  const voiced = Object.values(definition.nodes).some((node) => node.voice);
  const channels = channelsOf(definition.output ?? (voiced ? ["voices.left", "voices.right"] : undefined));
  return channels.length === 1 ? [channels[0], channels[0]] : channels;
};

/** Compose a chain's links, in order, into one definition and its params. */
export const composeChain = (links: ChainLink[]): ComposedChain => {
  const nodes: Record<string, DefinitionNode> = {};
  const schema: ParamSpec[] = [];
  const params: ComposedChain["params"] = {};
  // What the device before each link plays (its references already renamed), or the track's input.
  let previous: [string, string] = ["input.left", "input.right"];
  let first = true;
  links.forEach((link, index) => {
    const prefix = prefixOf(link.key);
    const namespaced = (param: string) => chainParam(link.key, param);
    const before = previous;
    /** A reference in this link's terms, as the chain names it. */
    const rename = (reference: string): string => {
      if (reference === "input.left" && !first) return before[0];
      if (reference === "input.right" && !first) return before[1];
      if (SHARED_SIGNALS.has(reference) || reference.startsWith("input.")) return reference;
      return `${prefix}${reference}`;
    };
    const bind = (binding: ParamBinding): ParamBinding => ({ ...binding, param: namespaced(binding.param) });
    const amount = (value: number | ParamBinding | undefined) =>
      value === undefined || typeof value === "number" ? value : bind(value);
    const item = (value: SingleInput): SingleInput => {
      if (typeof value === "number") return value;
      if (typeof value === "string") return rename(value);
      if (isScaled(value)) {
        const scaled = { ...value, from: rename(value.from) };
        if (value.scale !== undefined) scaled.scale = amount(value.scale);
        if (value.offset !== undefined) scaled.offset = amount(value.offset);
        return scaled;
      }
      if (isSynced(value)) return typeof value.beats === "object" ? { ...value, beats: bind(value.beats) } : value;
      return bind(value);
    };
    const input = (value: InputValue): InputValue =>
      Array.isArray(value) ? value.map(item) : item(value as SingleInput);

    Object.entries(link.definition.nodes).forEach(([name, node]) => {
      nodes[`${prefix}${name}`] = {
        ...node,
        ...(node.inputs
          ? { inputs: Object.fromEntries(Object.entries(node.inputs).map(([port, value]) => [port, input(value)])) }
          : {}),
      };
    });
    link.schema.forEach((spec) => {
      schema.push({ ...spec, id: namespaced(spec.id) });
      params[namespaced(spec.id)] = { link: index, param: spec.id };
    });

    const played = outputOf(link.definition).map(rename) as [string, string];
    if (!link.effect) {
      previous = played;
    } else {
      // Crossfade the effect's output with its input: wet = mix × (1 − bypass), dry = 1 − wet.
      const hasMix = link.schema.some((spec) => spec.id === MIX);
      schema.push({ id: namespaced(BYPASS), label: "Bypass", kind: "boolean", default: false });
      params[namespaced(BYPASS)] = { link: index, param: BYPASS };
      nodes[`${prefix}wet`] = {
        block: "mul",
        inputs: {
          a: hasMix ? { param: namespaced(MIX) } : 1,
          b: { param: namespaced(BYPASS), scale: -1, offset: 1 },
        },
      };
      previous = (["left", "right"] as const).map((side, channel) => {
        nodes[`${prefix}wet_${side}`] = { block: "mul", inputs: { a: played[channel], b: `${prefix}wet` } };
        nodes[`${prefix}dry_${side}`] = {
          block: "mul",
          inputs: { a: before[channel], b: { from: `${prefix}wet`, scale: -1, offset: 1 } },
        };
        nodes[`${prefix}out_${side}`] = {
          block: "add",
          inputs: { a: `${prefix}wet_${side}`, b: `${prefix}dry_${side}` },
        };
        return `${prefix}out_${side}`;
      }) as [string, string];
    }
    first = false;
  });

  const instrument = links.find((link) => !link.effect);
  const instrumentKey = instrument?.key ?? "";
  const definition: DeviceDefinition = {
    format: 1,
    nodes,
    output: previous,
    ...(instrument
      ? {
          voices: instrument.definition.voices ?? DEFAULT_VOICES,
          ...(instrument.definition.voice !== undefined
            ? { voice: renameVoice(instrument.definition.voice, prefixOf(instrumentKey)) }
            : {}),
          ...(instrument.definition.zones
            ? {
                zones: instrument.definition.zones.map((zone) => ({
                  ...zone,
                  sample: { param: chainParam(instrumentKey, zone.sample.param) },
                })),
              }
            : {}),
        }
      : {}),
  };
  const latency = links.reduce((total, link) => total + (link.definition.latency ?? 0), 0);
  if (latency > 0) definition.latency = latency;
  return { definition, schema, params };
};
