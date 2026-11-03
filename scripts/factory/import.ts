/**
 * Make the factory sample sets (INST-55): `yarn factory:import [set]`. For each set in `sets.ts`, reads
 * its SFZ instrument from GitHub at the pinned commit, keeps the regions its curation picks, and turns
 * each recording into a 16-bit FLAC: capped to the set's length, faded out, and named by the SHA-256 of
 * its bytes, so a file is the same wherever it's made and never changes. The maps go to
 * `src/audio/samples/sets/<set>.json` (committed); the files to `~/.cache/corrente-factory/out/`, for
 * `yarn factory:upload` (packages/server) to put in the public bucket.
 *
 * The libraries' own files are read once into `~/.cache/corrente-factory/<set>/<commit>/`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { FLACDecoder } from "@wasm-audio-decoders/flac";
import flacFactory from "libflacjs";
import { Encoder } from "libflacjs/lib/encoder";
import { parseSfz } from "./sfz";
import { FACTORY_SETS, type FactorySetSource } from "./sets";
import type { FactorySet } from "../../src/audio/samples/factory";

const CACHE = join(homedir(), ".cache", "corrente-factory");
export const FACTORY_OUT = join(CACHE, "out");
const MAPS = join(import.meta.dirname, "../../src/audio/samples/sets");

/** A file of the library at its commit, from the cache or fetched into it. */
async function sourceFile(set: FactorySetSource, path: string): Promise<Buffer> {
  const local = join(CACHE, set.id, set.commit, path);
  if (!existsSync(local)) {
    const url = `https://raw.githubusercontent.com/${set.repo}/${set.commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, Buffer.from(await response.arrayBuffer()));
  }
  return readFileSync(local);
}

/** The library's text files (its SFZ and what it includes), fetched before parsing, which reads them in turn. */
async function textFiles(set: FactorySetSource): Promise<Map<string, string>> {
  const tree = await fetch(`https://api.github.com/repos/${set.repo}/git/trees/${set.commit}?recursive=1`).then(
    (response) => response.json() as Promise<{ tree: { path: string; type: string }[] }>,
  );
  const paths = tree.tree
    .filter((entry) => entry.type === "blob" && /\.(sfz|txt)$/i.test(entry.path))
    .map((entry) => entry.path);
  const texts = await Promise.all(
    paths.map(async (path) => [path, (await sourceFile(set, path)).toString("utf8")] as const),
  );
  return new Map(texts);
}

/** A recording capped to `cap` seconds, the last `fade` of it faded out, as 16-bit FLAC. */
function encoded(
  Flac: ReturnType<typeof flacFactory>,
  channels: Float32Array[],
  rate: number,
  cap: number,
  fade: number,
) {
  const frames = Math.min(channels[0].length, Math.round(cap * rate));
  const fadeFrames = Math.min(frames, Math.round(fade * rate));
  const shorts = channels.map((channel) =>
    Int32Array.from({ length: frames }, (_, frame) => {
      // Only a recording cut short fades: one that ends on its own already has.
      const gain = frames < channel.length && frame >= frames - fadeFrames ? (frames - frame) / fadeFrames : 1;
      return Math.max(-32768, Math.min(32767, Math.round(channel[frame] * gain * 32768)));
    }),
  );
  const encoder = new Encoder(Flac, { sampleRate: rate, channels: shorts.length, bitsPerSample: 16, compression: 8 });
  encoder.encode(shorts);
  encoder.encode();
  const bytes = Buffer.from(encoder.getSamples());
  encoder.destroy();
  return { bytes, frames };
}

async function importSet(set: FactorySetSource): Promise<void> {
  const texts = await textFiles(set);
  const regions = parseSfz(set.entry, (path) => {
    const text = texts.get(path);
    if (text === undefined) throw new Error(`${set.id}: ${path} isn't in ${set.repo}`);
    return text;
  });
  const decoder = new FLACDecoder();
  await decoder.ready;
  const Flac = flacFactory();
  mkdirSync(FACTORY_OUT, { recursive: true });
  // Each source recording once, however many sounds keep it.
  const made = new Map<string, { file: string; frames: number; channels: number; rate: number; bytes: number }>();
  const recording = async (sample: string) => {
    const known = made.get(sample);
    if (known) return known;
    await decoder.reset();
    const { channelData, sampleRate } = await decoder.decodeFile(await sourceFile(set, sample));
    const channels = channelData.slice(0, 2);
    const { bytes, frames } = encoded(Flac, channels, sampleRate, set.capSeconds, set.fadeSeconds);
    const file = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(FACTORY_OUT, `${file}.flac`), bytes);
    const entry = { file, frames, channels: channels.length, rate: sampleRate, bytes: bytes.length };
    made.set(sample, entry);
    return entry;
  };
  const sounds: FactorySet["sounds"] = [];
  for (const sound of set.sounds) {
    const kept = sound.keep(regions);
    const mapped = [];
    // One at a time: a decoder decodes one file at once.
    for (const { region, lovel, hivel } of kept) {
      const audio = await recording(region.sample);
      const number = (opcode: string, otherwise: number) => Number(region.opcodes[opcode] ?? otherwise);
      const key = number("key", NaN);
      mapped.push({
        ...audio,
        lokey: number("lokey", key),
        hikey: number("hikey", key),
        lovel,
        hivel,
        // SFZ's `tune` is cents the recording is played up by: the same as rooting it that much lower.
        keycenter: number("pitch_keycenter", key) - number("tune", 0) / 100,
      });
    }
    sounds.push({ id: sound.id, name: sound.name, regions: mapped });
    const bytes = mapped.reduce((sum, region) => sum + region.bytes, 0);
    const memory = mapped.reduce((sum, region) => sum + region.frames * region.channels * 2, 0);
    console.log(
      `${set.id}/${sound.id}: ${mapped.length} regions, ${(bytes / 1e6).toFixed(1)} MB to download, ${(memory / 1e6).toFixed(1)} MB in the engine`,
    );
  }
  decoder.free();
  const out: FactorySet = {
    id: set.id,
    name: set.name,
    licence: set.licence,
    credit: set.credit,
    source: `https://github.com/${set.repo}/tree/${set.commit}`,
    sounds,
  };
  mkdirSync(MAPS, { recursive: true });
  writeFileSync(join(MAPS, `${set.id}.json`), `${JSON.stringify(out, null, 2)}\n`);
}

/** The credits the licences ask for, beside the maps: every set's, whichever were imported this time. */
function writeCredits(): void {
  const lines = FACTORY_SETS.map(
    (set) =>
      `- **${set.name}**: ${set.credit}. ${set.licence}, from https://github.com/${set.repo} (${set.commit.slice(0, 7)}).`,
  );
  const text = [
    "# Factory sample credits",
    "",
    "The sampled instruments (INST-55) are curated from these openly licensed libraries by `yarn factory:import`:",
    "trimmed, faded, and made 16-bit, which the licences allow.",
    "",
    ...lines,
    "",
  ].join("\n");
  writeFileSync(join(MAPS, "CREDITS.md"), text);
}

const wanted = process.argv[2];
const sets = FACTORY_SETS.filter((set) => !wanted || set.id === wanted);
if (sets.length === 0) throw new Error(`no factory set ${wanted}: ${FACTORY_SETS.map((set) => set.id).join(", ")}`);
for (const set of sets) await importSet(set);
writeCredits();
