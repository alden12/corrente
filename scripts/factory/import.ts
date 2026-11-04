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
import { dirname, join, posix } from "node:path";
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

/** A recording capped to `cap` seconds, the last `fade` of it faded out, scaled by `gain`, as 16-bit FLAC. */
function encoded(
  Flac: ReturnType<typeof flacFactory>,
  channels: Float32Array[],
  rate: number,
  { cap, fade, gain }: { cap: number; fade: number; gain: number },
) {
  const frames = Math.min(channels[0].length, Math.round(cap * rate));
  const fadeFrames = Math.min(frames, Math.round(fade * rate));
  const shorts = channels.map((channel) =>
    Int32Array.from({ length: frames }, (_, frame) => {
      // Only a recording cut short fades: one that ends on its own already has.
      const faded = frames < channel.length && frame >= frames - fadeFrames ? (frames - frame) / fadeFrames : 1;
      return Math.max(-32768, Math.min(32767, Math.round(channel[frame] * faded * gain * 32768)));
    }),
  );
  const encoder = new Encoder(Flac, { sampleRate: rate, channels: shorts.length, bitsPerSample: 16, compression: 8 });
  encoder.encode(shorts);
  encoder.encode();
  const bytes = Buffer.from(encoder.getSamples());
  encoder.destroy();
  return { bytes, frames };
}

/** Recordings summed sample by sample into stereo, a mono one into both sides. */
const mixed = (takes: Float32Array[][]): Float32Array[] => {
  const frames = Math.max(...takes.map((channels) => channels[0].length));
  return [0, 1].map((side) => {
    const out = new Float32Array(frames);
    takes.forEach((channels) => {
      const channel = channels[Math.min(side, channels.length - 1)];
      channel.forEach((value, frame) => {
        out[frame] += value;
      });
    });
    return out;
  });
};

/** How loud a recording gets: its largest sample either way. */
const peakOf = (channels: Float32Array[]) =>
  channels.reduce((most, channel) => channel.reduce((peak, value) => Math.max(peak, Math.abs(value)), most), 0);

/** Where a mixed-down library's loudest hit lands: -1 dBFS, the dynamics between hits kept. */
const MIX_PEAK = 0.89;

async function importSet(set: FactorySetSource): Promise<void> {
  const texts = await textFiles(set);
  // The instrument's paths are relative to its own folder, which may not be the repository's top.
  const folder = posix.dirname(set.entry);
  const inRepo = (path: string) => posix.normalize(posix.join(folder, path));
  const parsed = parseSfz(posix.basename(set.entry), (path) => {
    const text = texts.get(inRepo(path));
    if (text === undefined) throw new Error(`${set.id}: ${path} isn't in ${set.repo}`);
    return text;
  });
  // A multi-mic library is curated from its lead mic's regions; the rest are mixed into each hit.
  const [lead, ...others] = set.mics ?? [];
  const regions = lead ? parsed.filter((region) => region.sample.includes(`/${lead}/`)) : parsed;
  const decoder = new FLACDecoder();
  await decoder.ready;
  const Flac = flacFactory();
  mkdirSync(FACTORY_OUT, { recursive: true });

  // One at a time: a decoder decodes one file at once.
  const decoded = async (path: string) => {
    await decoder.reset();
    const { channelData, sampleRate } = await decoder.decodeFile(await sourceFile(set, inRepo(path)));
    return { channels: channelData.slice(0, 2), rate: sampleRate };
  };
  /** A hit as it will be kept: the recording, or with mics, it and its counterparts mixed down. */
  const hitAudio = async (sample: string) => {
    if (!lead) return decoded(sample);
    const counterpart = (mic: string) => sample.replace(`/${lead}/`, `/${mic}/`).replace(`/${lead}_`, `/${mic}_`);
    const takes = [await decoded(sample)];
    for (const mic of others) takes.push(await decoded(counterpart(mic)));
    return { channels: mixed(takes.map((take) => take.channels)), rate: takes[0].rate };
  };

  const curated = set.sounds.map((sound) => ({ sound, kept: sound.keep(regions) }));
  // Each source recording once, however many sounds keep it: read every one first, so a mixed-down
  // library can be scaled as a whole to its loudest hit.
  const audio = new Map<string, Awaited<ReturnType<typeof hitAudio>>>();
  for (const { region } of curated.flatMap(({ kept }) => kept)) {
    if (!audio.has(region.sample)) audio.set(region.sample, await hitAudio(region.sample));
  }
  decoder.free();
  const loudest = Math.max(...[...audio.values()].map((hit) => peakOf(hit.channels)));
  // A library as recorded is left as it is (the piano's files don't change); a mixdown is scaled.
  const gain = lead ? MIX_PEAK / loudest : 1;

  const made = new Map(
    [...audio].map(([sample, { channels, rate }]) => {
      const { bytes, frames } = encoded(Flac, channels, rate, { cap: set.capSeconds, fade: set.fadeSeconds, gain });
      const file = createHash("sha256").update(bytes).digest("hex");
      writeFileSync(join(FACTORY_OUT, `${file}.flac`), bytes);
      return [sample, { file, frames, channels: channels.length, rate, bytes: bytes.length }] as const;
    }),
  );
  const sounds: FactorySet["sounds"] = curated.map(({ sound, kept }) => {
    const mapped = kept.map(({ region, lovel, hivel }) => {
      const number = (opcode: string, otherwise: number) => Number(region.opcodes[opcode] ?? otherwise);
      const key = number("key", NaN);
      return {
        ...made.get(region.sample)!,
        // A drum answers every key at its own pitch: its pad picks it by the pad's note.
        lokey: sound.anyKey ? 0 : number("lokey", key),
        hikey: sound.anyKey ? 127 : number("hikey", key),
        lovel,
        hivel,
        // SFZ's `tune` is cents the recording is played up by: the same as rooting it that much lower.
        keycenter: sound.anyKey ? 60 : number("pitch_keycenter", key) - number("tune", 0) / 100,
      };
    });
    const bytes = mapped.reduce((sum, region) => sum + region.bytes, 0);
    const memory = mapped.reduce((sum, region) => sum + region.frames * region.channels * 2, 0);
    console.log(
      `${set.id}/${sound.id}: ${mapped.length} regions, ${(bytes / 1e6).toFixed(1)} MB to download, ${(memory / 1e6).toFixed(1)} MB in the engine`,
    );
    return { id: sound.id, name: sound.name, regions: mapped };
  });
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
