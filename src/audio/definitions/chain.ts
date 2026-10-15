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
 *   `mix` param (if its schema has one) times not `bypass`, 0 or 1, which the chain adds. Moving
 *   either ramps, with no reload: mix over its `smoothMs`, bypass over 20 ms (a faster crossfade
 *   between two different sounds thumps). A bypassed effect still runs.
 * - **A sidechain is the effect's own input unless it's keyed:** `input.sidechainLeft/Right` in an
 *   effect read what comes before it, so a compressor compresses itself, unless the link is `keyed`
 *   (another track feeds the slot's sidechain; such an effect is a piece of its own, chainPlan.ts).
 * - **A late effect's dry path is as late:** an effect whose definition declares `latency` has its
 *   input delayed by as much on the way to the crossfade, so dry and wet line up at any mix.
 *
 * Pure and DOM-free: the engines compose, the bank never sees anything but the compiled plan.
 */
import type { ParamSchema, ParamSpec } from "../params/types";
import {
  HOST_SIGNALS,
  VOICE_SIGNALS,
  VOICE_SUM,
  type DefinitionNode,
  type DeviceDefinition,
  type InputValue,
  type ParamBinding,
  type Zone,
} from "./format";
import { blockNamed } from "./catalogue";
import { isScaled, isSynced, outputOf, voicesOf } from "./references";

/** One device in a chain: its key (unique in the chain, e.g. the effect's id), definition and params. */
export interface ChainLink {
  key: string;
  definition: DeviceDefinition;
  schema: ParamSchema;
  /** An effect: its input is what comes before it, and it gets mix and bypass. */
  effect: boolean;
  /** An effect keyed by another track: its sidechain reads the slot's, not its own input. */
  keyed?: boolean;
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
/** How long bypassing takes: a crossfade much shorter than this between two different sounds thumps. */
const BYPASS_SMOOTH_MS = 20;
/** The fewest samples a delay holds: its `size`'s minimum. */
const MIN_DELAY_SIZE = blockNamed("delay")!.controls.find((port) => port.name === "size")!.min;
/** The param an effect's schema carries for its wet/dry, if it has one. */
const MIX = "mix";

/** A link's param, namespaced in the chain. */
export const chainParam = (key: string, param: string) => `${key}.${param}`;

/** A link's node-name prefix: its key made a valid name (letters, digits and _, a letter first). */
export const linkPrefix = (key: string) => `x${key.replace(/[^A-Za-z0-9]/g, "_")}_`;

/** Signals every device reads as they are: the voice's, the voices summed, and the host's. */
const SHARED_SIGNALS = new Set<string>([
  ...Object.keys(VOICE_SIGNALS),
  ...Object.keys(VOICE_SUM),
  ...Object.keys(HOST_SIGNALS),
]);

/** One input item: a number, a reference, a param, a scaled reference or a synced length. */
type SingleInput = Exclude<InputValue, unknown[]>;

/** An instrument's `voice` (one reference or a left and a right) in the chain's names. */
/** A zone with every param it reads (its sample, and any setting bound to one) under the link's name. */
const renameZone = (zone: Zone, key: string): Zone => {
  const renamed = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(renamed)
      : typeof value === "object" && value !== null && "param" in value
        ? { ...value, param: chainParam(key, (value as ParamBinding).param) }
        : value;
  return Object.fromEntries(Object.entries(zone).map(([setting, value]) => [setting, renamed(value)])) as Zone;
};

const renameVoice = (voice: string | [string, string], prefix: string): string | [string, string] => {
  const rename = (reference: string) => (SHARED_SIGNALS.has(reference) ? reference : `${prefix}${reference}`);
  return typeof voice === "string" ? rename(voice) : [rename(voice[0]), rename(voice[1])];
};

/** What a definition plays, in both channels (a mono output in each). */
const stereoOutputOf = (definition: DeviceDefinition): [string, string] => {
  const channels = outputOf(definition);
  return channels.length === 1 ? [channels[0], channels[0]] : (channels as [string, string]);
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
    const prefix = linkPrefix(link.key);
    // The nodes the chain adds for a link: a second _, which no node's own name (a letter first) begins with.
    const added = (name: string) => `${prefix}_${name}`;
    const namespaced = (param: string) => chainParam(link.key, param);
    const before = previous;
    /** A reference in this link's terms, as the chain names it. */
    const rename = (reference: string): string => {
      if (reference === "input.left" && !first) return before[0];
      if (reference === "input.right" && !first) return before[1];
      if (reference === "input.sidechainLeft" && link.effect && !link.keyed) return before[0];
      if (reference === "input.sidechainRight" && link.effect && !link.keyed) return before[1];
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

    const played = stereoOutputOf(link.definition).map(rename) as [string, string];
    if (!link.effect) {
      previous = played;
    } else {
      // Crossfade the effect's output with its input: wet = mix × (1 − bypass), dry = 1 − wet.
      const hasMix = link.schema.some((spec) => spec.id === MIX);
      // A number rather than a switch, so it can say how long it takes; only the chain sets it.
      schema.push({
        id: namespaced(BYPASS),
        label: "Bypass",
        kind: "number",
        min: 0,
        max: 1,
        default: 0,
        smoothMs: BYPASS_SMOOTH_MS,
      });
      params[namespaced(BYPASS)] = { link: index, param: BYPASS };
      nodes[added("wet")] = {
        block: "mul",
        inputs: {
          a: hasMix ? { param: namespaced(MIX) } : 1,
          b: { param: namespaced(BYPASS), scale: -1, offset: 1 },
        },
      };
      const late = link.definition.latency ?? 0;
      previous = (["left", "right"] as const).map((side, channel) => {
        nodes[added(`wet_${side}`)] = { block: "mul", inputs: { a: played[channel], b: added("wet") } };
        if (late > 0)
          nodes[added(`late_${side}`)] = {
            block: "delay",
            inputs: { signal: before[channel], length: late, size: Math.max(late, MIN_DELAY_SIZE) },
          };
        nodes[added(`dry_${side}`)] = {
          block: "mul",
          inputs: {
            a: late > 0 ? added(`late_${side}`) : before[channel],
            b: { from: added("wet"), scale: -1, offset: 1 },
          },
        };
        nodes[added(`out_${side}`)] = {
          block: "add",
          inputs: { a: added(`wet_${side}`), b: added(`dry_${side}`) },
        };
        return added(`out_${side}`);
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
          // Its own count, or as many as its voice nodes give it (none if it has none).
          voices: voicesOf(instrument.definition),
          ...(instrument.definition.voice !== undefined
            ? { voice: renameVoice(instrument.definition.voice, linkPrefix(instrumentKey)) }
            : {}),
          ...(instrument.definition.zones
            ? {
                zones: instrument.definition.zones.map((zone) => renameZone(zone, instrumentKey)),
              }
            : {}),
        }
      : {}),
  };
  const latency = links.reduce((total, link) => total + (link.definition.latency ?? 0), 0);
  if (latency > 0) definition.latency = latency;
  return { definition, schema, params };
};
