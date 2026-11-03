/**
 * Grand Piano (INST-50.1): Salamander's Yamaha C5, three velocity layers, as an instrument of its own
 * rather than a Sampler patch, so it is in the Instruments list and patches can be made of it. It
 * plays as the Sampler does; a sample map's regions carry their own root, so there is none to set.
 */
import type { EngineBuiltin } from "../../definitions/builtin";
import type { ParamSchema, ParamSpec } from "../../params/types";
import { factoryRef } from "../../samples/factory";
import { sampler, samplerSchema } from "./sampler";

/** The Sampler's param, with this instrument's default (and label, if given). */
const samplerParam = (id: string, overrides: Partial<ParamSpec>): ParamSpec =>
  ({ ...samplerSchema.find((spec) => spec.id === id)!, ...overrides }) as ParamSpec;

export const grandPianoSchema: ParamSchema = [
  // The one-layer Lite version is here too, a third of the memory, for phones (INST-56.2 makes it a setting).
  samplerParam("sampler.sample", { label: "Recording", default: factoryRef("salamander", "grand") }),
  // The loudest layer is a hard strike: a loud four-note chord peaks near -6 dBFS here.
  samplerParam("amp.level", { default: 0.35 }),
  samplerParam("env.attack", {}),
  samplerParam("env.release", { default: 600 }),
  // A key struck again lets its last note die away under the new one, as the string does.
  samplerParam("sampler.restrike", { default: 400 }),
];

export const grandPiano: EngineBuiltin = {
  type: "grand-piano",
  label: "Grand Piano",
  family: "Keys",
  tags: ["keys", "warm"],
  color: "amber",
  schema: grandPianoSchema,
  definition: { ...sampler.definition, zones: [{ sample: { param: "sampler.sample" }, root: 60 }] },
};
