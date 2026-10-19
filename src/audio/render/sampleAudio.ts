/**
 * A sample param's audio for the engine, wherever it is decoded (AGENT-4.9). Where the bytes come
 * from differs (the browser fetches and decodes with Web Audio, Node reads files), so that part is
 * passed in; what to make of them, a sample as it is or a band-limited wavetable, is shared here.
 */
import { buildBanks } from "../dsp/wavetable";
import { BUILTIN_WAVETABLES, parseRef } from "../samples/catalog";
import { cyclesOf, tableOf } from "../samples/tables";
import type { SampleAudio } from "../bank/bank";

/** A sample ref's audio, up to two channels at its own rate; null for none or one that won't load. */
export type LoadSample = (ref: string) => Promise<SampleAudio | null>;

/** Built-in wavetables, made once each: their levels take a moment to work out. */
const builtinTables = new Map<string, Float32Array>();

/**
 * What the engine gets for a sample param: the sample, or played as a wavetable, a band-limited table
 * (a built-in, or a sample's first channel cut into 2048-sample cycles). Null for none, or a sample
 * shorter than a cycle.
 */
export async function sampleAudioFor(
  ref: string,
  asTable: boolean,
  load: LoadSample,
  sampleRate: number,
): Promise<SampleAudio | null> {
  if (!asTable) return load(ref);
  const parsed = parseRef(ref);
  if (parsed.kind === "wavetable") {
    const index = BUILTIN_WAVETABLES.findIndex((table) => table.id === parsed.id);
    if (index < 0) return null;
    const table = builtinTables.get(parsed.id) ?? tableOf(buildBanks()[index]);
    builtinTables.set(parsed.id, table);
    return { channels: [table], rate: sampleRate };
  }
  const audio = await load(ref);
  const cycles = audio ? cyclesOf(audio.channels[0]) : [];
  return cycles.length > 0 ? { channels: [tableOf(cycles)], rate: sampleRate } : null;
}
