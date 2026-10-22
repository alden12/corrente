/**
 * Grouping a param schema into labeled sections by id namespace (the part before the
 * dot: `osc.` / `filter.` / `pad3.` / ...), shared by every device's panel. Numbered pad
 * sections sort first (in pad order), then the known synth sections in signal-flow order,
 * then any unknown namespace (title-cased). Params with no namespace (an effect's `mix`, or
 * a device that names its params plainly) share one untitled section, last.
 */
import type { ParamSpec } from "../audio/params/types";

/** Friendly titles + display order for known id namespaces (the part before the dot). */
export const SECTION_LABELS: Record<string, string> = {
  lfo: "LFO",
  lfo1: "LFO 1",
  lfo2: "LFO 2",
  osc: "Oscillator",
  o1: "Oscillator 1",
  o2: "Oscillator 2",
  noise: "Noise",
  fm: "FM",
  super: "Unison",
  organ: "Tone",
  wt: "Wavetable",
  sampler: "Sampler",
  filter: "Filter",
  f: "Filter",
  fenv: "Filter Env",
  eg1: "Filter Env",
  env: "Envelope",
  eg2: "Amp Env",
  amp: "Amp",
  dist: "Drive",
  mod: "Chorus",
  dly: "Delay",
};
const SECTION_ORDER = Object.keys(SECTION_LABELS);

/** An id's namespace: the part before the dot, or "" (the untitled section) for one with none. */
export const namespaceOf = (id: string) => (id.includes(".") ? id.slice(0, id.indexOf(".")) : "");
export const padNumber = (namespace: string) => /^pad(\d+)$/.exec(namespace)?.[1];

export const sectionTitle = (namespace: string) => {
  const pad = padNumber(namespace);
  if (pad) return `Pad ${pad}`;
  if (namespace === "") return "";
  return SECTION_LABELS[namespace] ?? namespace.charAt(0).toUpperCase() + namespace.slice(1);
};

/** Sort key: numbered pad sections first (in pad order), then the known synth sections
 *  (lfo -> ... -> amp), then any other namespace, then the untitled one. */
export function sectionRank(namespace: string): number {
  const pad = padNumber(namespace);
  if (pad) return Number(pad); // 1..N, before everything else
  if (namespace === "") return 2000;
  const known = SECTION_ORDER.indexOf(namespace);
  return known === -1 ? 1000 : 100 + known;
}

export interface ParamSection {
  namespace: string;
  specs: ParamSpec[];
}

/** Group a schema into ordered sections by id namespace, preserving in-section order. */
export function toSections(schema: readonly ParamSpec[]): ParamSection[] {
  const groups = new Map<string, ParamSpec[]>();
  for (const spec of schema) {
    const namespace = namespaceOf(spec.id);
    const specs = groups.get(namespace) ?? [];
    specs.push(spec);
    groups.set(namespace, specs);
  }
  return [...groups.keys()]
    .sort((a, b) => sectionRank(a) - sectionRank(b))
    .map((namespace) => ({ namespace, specs: groups.get(namespace)! }));
}
