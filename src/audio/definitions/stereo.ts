/**
 * Stereo nodes (INST-42): a node marked `stereo: true` runs once per channel, so an effect writes its
 * processing once rather than a copy for the left and a copy for the right. It's sugar: before
 * anything else reads a definition, each stereo node `x` becomes two plain ones, `x_left` and
 * `x_right`, and everything downstream (the checks, the compiler, chains) sees only those.
 *
 * Inside a stereo node's inputs, for each copy:
 * - `input` is that channel's input (`input.left` or `input.right`), `input.sidechain` its sidechain,
 *   and `voices` the voices summed on that channel;
 * - a stereo node is the same channel's copy (`x.port` too);
 * - anything else, an LFO say, is shared by both;
 * - `{ "left": ..., "right": ... }` gives each channel its own.
 *
 * Elsewhere a stereo node is read one channel at a time, as `x_left` or `x_right`, except in `voice`
 * and `output`, where `x` alone means both. DOM-free, like the rest of the format.
 */
import type { AuthoredDefinition, DeviceDefinition } from "./format";

const SIDES = ["left", "right"] as const;
type Side = (typeof SIDES)[number];

/** What a stereo node's bare signal names mean on each side. */
const SIDED_SIGNALS: Record<string, Record<Side, string>> = {
  input: { left: "input.left", right: "input.right" },
  "input.sidechain": { left: "input.sidechainLeft", right: "input.sidechainRight" },
  voices: { left: "voices.left", right: "voices.right" },
};

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
/** An input given per channel. */
const isSided = (value: unknown): value is Record<Side, unknown> =>
  isObject(value) && Object.keys(value).length === 2 && "left" in value && "right" in value;

/** A copy's name. */
export const sideName = (name: string, side: Side): string => `${name}_${side}`;

/**
 * A definition with its stereo nodes made plain, or as it was if it has none. Anything it doesn't
 * recognise passes through for the checks to report, so this never throws; the names it would make
 * that are taken already come back as problems.
 */
export const expandStereo = (definition: unknown): { definition: unknown; problems: string[] } => {
  if (!isObject(definition) || !isObject(definition.nodes)) return { definition, problems: [] };
  const nodes = definition.nodes;
  const stereo = new Set(Object.keys(nodes).filter((name) => isObject(nodes[name]) && nodes[name].stereo === true));
  const sided = Object.values(nodes).some(
    (node) => isObject(node) && isObject(node.inputs) && Object.values(node.inputs).some(isSided),
  );
  if (stereo.size === 0 && !sided) return { definition, problems: [] };

  const taken = [...stereo].flatMap((name) =>
    SIDES.map((side) => sideName(name, side))
      .filter((copy) => copy in nodes)
      .map((copy) => `${name}: its ${copy.slice(name.length + 1)} copy would be named ${copy}, which is taken`),
  );
  /** The references in an input, wherever they are. */
  const referencesIn = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(referencesIn);
    if (typeof value === "string") return [value];
    return isObject(value) && typeof value.from === "string" ? [value.from] : [];
  };
  // What a shared node can't do with a stereo one: it has no channel to pick by.
  const shared = Object.entries(nodes).flatMap(([name, node]) =>
    stereo.has(name) || !isObject(node) || !isObject(node.inputs)
      ? []
      : Object.entries(node.inputs).flatMap(([port, value]) => [
          ...(isSided(value) ? [`${name}.${port}: { left, right } is for a stereo node`] : []),
          ...referencesIn(value)
            .filter((reference) => stereo.has(reference.split(".")[0]))
            .map((reference) => {
              const [stereoName] = reference.split(".");
              return `${name}.${port}: ${stereoName} is stereo, so read one channel: ${sideName(stereoName, "left")} or ${sideName(stereoName, "right")}`;
            }),
        ]),
  );
  const problems = [...taken, ...shared];

  /** A reference, as one side of a stereo node reads it. */
  const onSide = (reference: string, side: Side): string => {
    if (reference in SIDED_SIGNALS) return SIDED_SIGNALS[reference][side];
    const [name, ...rest] = reference.split(".");
    return stereo.has(name) ? [sideName(name, side), ...rest].join(".") : reference;
  };
  /** One input for one side: per-channel picked, references moved to that side. */
  const inputOn = (value: unknown, side: Side): unknown => {
    if (isSided(value)) return inputOn(value[side], side);
    if (Array.isArray(value)) return value.map((each) => inputOn(each, side));
    if (typeof value === "string") return onSide(value, side);
    if (isObject(value) && typeof value.from === "string") return { ...value, from: onSide(value.from, side) };
    return value;
  };

  const plain = Object.fromEntries(
    Object.entries(nodes).flatMap(([name, node]) => {
      if (!stereo.has(name) || !isObject(node)) return [[name, node]];
      // Everything but the flag and the inputs carries over as written, for the checks to see.
      const rest = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "stereo" && key !== "inputs"));
      const inputs = node.inputs;
      return SIDES.map((side) => [
        sideName(name, side),
        {
          ...rest,
          ...(isObject(inputs) && {
            inputs: Object.fromEntries(Object.entries(inputs).map(([port, value]) => [port, inputOn(value, side)])),
          }),
        },
      ]);
    }),
  );
  /** `voice` or `output` naming a stereo node alone: both of its channels. */
  const bothSides = (channels: unknown): unknown => {
    if (typeof channels !== "string") return channels;
    const [name] = channels.split(".");
    return stereo.has(name) ? SIDES.map((side) => onSide(channels, side)) : channels;
  };
  return {
    definition: {
      ...definition,
      nodes: plain,
      ...("voice" in definition && { voice: bothSides(definition.voice) }),
      ...("output" in definition && { output: bothSides(definition.output) }),
    },
    problems,
  };
};

/** A definition known to be good, made plain: what the engine is given. */
export const plainDefinition = (definition: AuthoredDefinition): DeviceDefinition =>
  expandStereo(definition).definition as DeviceDefinition;
