/**
 * PLUGIN-3: built-in instruments as device packages (src/audio/bank/devicePackage.ts), made in Node by
 * the app's own compiler (`chainPlan`, as a track plays them), samples embedded. The plugin has no
 * window yet to be handed one, so the first is built in as its default device (device.json), and the
 * plugin's tests play the rest.
 *
 *   npx tsx plugin/corrente/export.ts [type...] [--out dir]
 *
 * With no types, subtractive. With `--out`, every package is written there as `<type>.json`, and
 * device.json is left alone.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chainPlan } from "../../src/audio/bank/chainPlan";
import { devicePackage } from "../../src/audio/bank/devicePackage";
import { instrumentSchema } from "../../src/audio/instruments/catalog";
import { ENGINE_INSTRUMENTS } from "../../src/audio/instruments/engine";
import { ParamStore } from "../../src/audio/params/store";
import { sampleAudioFor } from "../../src/audio/render/sampleAudio";
import { parseRef } from "../../src/audio/samples/catalog";
import { builtinSampleUrl, loadNodeSample } from "../../server/render/nodeRender";
import { paramTitle } from "../../src/plugin/paramTitle";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const outDir = outAt >= 0 ? args[outAt + 1] : undefined;
const types = args.filter((arg, index) => !arg.startsWith("--") && (outAt < 0 || index !== outAt + 1));

/** A built-in sample's file, as the app bundles it; null for any other (there are none in Node). */
const file = async (ref: string) => {
  const parsed = parseRef(ref);
  if (parsed.kind !== "builtin") return null;
  return new Uint8Array(readFileSync(fileURLToPath(builtinSampleUrl(parsed.id))));
};

/** A wavetable's table as the app builds it. Its rate doesn't matter: a table is read by the cycle. */
const table = async (ref: string) => (await sampleAudioFor(ref, true, loadNodeSample, 48000))?.channels[0] ?? null;

const packageOf = async (type: string) => {
  const chain = chainPlan([{ key: "instrument", type, store: new ParamStore(instrumentSchema(type)) }], true);
  if (!chain) throw new Error(`${type} isn't an engine instrument`);
  const label = ENGINE_INSTRUMENTS.find((instrument) => instrument.type === type)?.label ?? type;
  return devicePackage(chain, label, { file, table }, paramTitle);
};

if (outDir) mkdirSync(outDir, { recursive: true });
for (const type of types.length > 0 ? types : ["subtractive"]) {
  const made = await packageOf(type);
  const out = outDir ? join(outDir, `${type}.json`) : fileURLToPath(new URL("device.json", import.meta.url));
  const json = JSON.stringify(made);
  writeFileSync(out, `${json}\n`);
  const samples = made.values.filter((value) => value.kind === "sample").length;
  console.log(`${made.label}: ${made.values.length} values (${samples} samples), ${json.length} bytes -> ${out}`);
  if (!outDir) break;
}
