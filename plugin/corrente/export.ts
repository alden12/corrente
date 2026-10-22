/**
 * PLUGIN-2: write one built-in instrument as the plugin plays it, so the plugin needs no TypeScript
 * at run time. The plan is compiled here by the app's own compiler (`chainPlan`, as a track plays
 * it), with its binding (bank/binding.ts: the param shaping the engine does) and the device's param
 * specs beside it.
 *
 *   npx tsx plugin/corrente/export.ts [type]      (default subtractive) -> plugin/corrente/device.json
 *
 * A device with a sample or wavetable param isn't supported yet: the plugin has no way to fill the
 * engine's sample slots.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bindingOf } from "../../src/audio/bank/binding";
import { chainPlan } from "../../src/audio/bank/chainPlan";
import { instrumentSchema } from "../../src/audio/instruments/catalog";
import { ENGINE_INSTRUMENTS } from "../../src/audio/instruments/engine";
import { ParamStore } from "../../src/audio/params/store";
import { namespaceOf, sectionTitle } from "../../src/ui/paramSections";

const type = process.argv[2] ?? "subtractive";
const schema = instrumentSchema(type);
if (schema.some((spec) => spec.kind === "sample"))
  throw new Error(`${type} plays samples, which the plugin can't load yet`);
const chain = chainPlan([{ key: "instrument", type, store: new ParamStore(schema) }], true);
if (!chain) throw new Error(`${type} isn't an engine instrument`);

const binding = bindingOf(chain.plan);
const device = {
  type,
  label: ENGINE_INSTRUMENTS.find((instrument) => instrument.type === type)?.label ?? type,
  words: Array.from(chain.plan.words),
  // eng_bind's words up to the values, which the plugin adds from its params.
  binding: binding.words,
  // Named as the app shows them, section first ("Filter Env Attack"), since the host lists them flat.
  params: schema.map((spec) => {
    const namespace = namespaceOf(spec.id);
    return { ...spec, name: namespace ? `${sectionTitle(namespace)} ${spec.label}` : spec.label };
  }),
  // The binding's value i is the param with this id in `params` (null for one nothing sets).
  values: binding.names.map((name) => chain.sources[name]?.id ?? null),
};
const out = fileURLToPath(new URL("device.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(device)}\n`);
console.log(
  `${device.label}: ${device.words.length} plan words, ${device.values.length} values, ${schema.length} params -> ${out}`,
);
