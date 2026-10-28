/**
 * Where the plugin window's packages get their samples (PLUGIN-3.2, 3.6): a built-in's file as the app
 * bundles it; a sample of your own from the window's storage, where importing put it; and a wavetable's
 * table made as the app makes it.
 *
 * The plugin decodes a sample's file itself, so one in a format it can't decode faithfully (an m4a,
 * whose encoder lead-in the browser trims and the plugin's decoder doesn't) goes as the browser decodes
 * it, a WAV (`playable`). WAV, AIFF, FLAC, Ogg and MP3 go as they are.
 *
 * The plugin saves every sample a package holds with the host's project, and hands them back when the
 * window opens (`SavedSamples`), so a sample of your own still plays on a machine whose window never
 * imported it: the window's storage is a cache, and the host's project is the record.
 */
import type { SampleAudio } from "../audio/bank/bank";
import type { PackageSamples } from "../audio/bank/devicePackage";
import { getAudioBuffer } from "../audio/audioStore";
import type { ProjectStore } from "../audio/project/projectStore";
import { sampleAudioFor } from "../audio/render/sampleAudio";
import { parseRef, type SampleRef } from "../audio/samples/catalog";
import { BUILTIN_URLS } from "../audio/samples/builtinUrls";
import { encodeWavChannels } from "../audio/recording/wav";

/** The samples the plugin saved, by ref, as base64: each one's file, and each wavetable's table. */
export interface SavedSamples {
  files: Record<string, string>;
  tables: Record<string, string>;
}

export const NO_SAMPLES: SavedSamples = { files: {}, tables: {} };

/** The rate a table is made at: it is read by the cycle, so any rate plays it the same. */
const TABLE_RATE = 48000;

/** A context only for decoding, made the first time a sample needs decoding. */
let decoder: OfflineAudioContext | undefined;
const decoderContext = () => (decoder ??= new OfflineAudioContext(1, 1, TABLE_RATE));

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/** A file's bytes decoded: up to two channels at its own rate. */
const decoded = async (bytes: Uint8Array): Promise<SampleAudio> => {
  const buffer = await decoderContext().decodeAudioData(bytes.slice().buffer);
  return {
    channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, channel) =>
      buffer.getChannelData(channel).slice(),
    ),
    rate: buffer.sampleRate,
  };
};

/** What a file's first bytes say it is, for the formats the plugin decodes as the browser does. */
const PASSES: ((bytes: Uint8Array) => boolean)[] = [
  (bytes) => tagAt(bytes, 0) === "RIFF" && tagAt(bytes, 8) === "WAVE",
  (bytes) => tagAt(bytes, 0) === "FORM" && ["AIFF", "AIFC"].includes(tagAt(bytes, 8)),
  (bytes) => tagAt(bytes, 0) === "fLaC",
  (bytes) => tagAt(bytes, 0) === "OggS",
  // MP3: an ID3 tag, or straight into a frame's sync bits.
  (bytes) => tagAt(bytes, 0).startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
];

const tagAt = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

/** A file the plugin can decode as it is, or else the browser's decoding of it as a WAV. */
export const playable = async (bytes: Uint8Array): Promise<Uint8Array | null> => {
  if (PASSES.some((passes) => passes(bytes))) return bytes;
  const audio = await decoded(bytes).catch(() => null);
  return audio && new Uint8Array(encodeWavChannels(audio.channels, audio.rate));
};

/** Each kind of ref's file bytes; a kind not listed has none. */
type FileSources = Partial<Record<SampleRef["kind"], (id: string, ref: string) => Promise<Uint8Array | null>>>;

export const pageSamples = (project: ProjectStore, saved: SavedSamples): PackageSamples => {
  const files: FileSources = {
    builtin: async (id) => {
      const url = BUILTIN_URLS[id];
      const response = url ? await fetch(url) : undefined;
      return response?.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    },
    // Your own: from the window's storage, else as the plugin saved it.
    asset: async (id, ref) => {
      const hash = project.getSamples().find((sample) => sample.id === id)?.contentHash;
      const stored = hash ? await getAudioBuffer(hash).catch(() => null) : null;
      if (stored) return playable(new Uint8Array(stored));
      return saved.files[ref] ? fromBase64(saved.files[ref]) : null;
    },
  };
  const file = async (ref: string): Promise<Uint8Array | null> => {
    const parsed = parseRef(ref);
    return (await files[parsed.kind]?.("id" in parsed ? parsed.id : "", ref)) ?? null;
  };
  return {
    file,
    // Made from the sample where it can be read; else the table the plugin saved.
    table: async (ref) => {
      const load = async (from: string) => {
        const bytes = await file(from);
        return bytes && decoded(bytes).catch(() => null);
      };
      const made = (await sampleAudioFor(ref, true, load, TABLE_RATE))?.channels[0];
      if (made) return made;
      const bytes = saved.tables[ref] ? fromBase64(saved.tables[ref]) : undefined;
      return bytes ? new Float32Array(bytes.slice().buffer) : null;
    },
  };
};
