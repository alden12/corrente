/**
 * A sample param's audio for the engine, wherever it is decoded (AGENT-4.9). Where the bytes come
 * from differs (the browser fetches and decodes with Web Audio, Node reads files), so that part is
 * passed in; what to make of them, a sample as it is or a band-limited wavetable, is shared here.
 */
import { builtinWavetable } from "../dsp/wavetable";
import { parseRef } from "../samples/catalog";
import { cyclesOf, tableOf } from "../samples/tables";
import type { SampleAudio } from "../bank/bank";

/** A sample ref's audio, up to two channels at its own rate; null for none or one that won't load. */
export type LoadSample = (ref: string) => Promise<SampleAudio | null>;

/** Built-in wavetables as tables, made once each: their levels take a moment to work out. */
const builtinTables = new Map<string, Float32Array | null>();

/**
 * What the engine gets for a sample param: the sample, or, played as a wavetable, a band-limited table
 * made from single cycles (a built-in's, or a sample's first channel cut into 2048-sample cycles).
 * Null for none, or a sample shorter than a cycle.
 */
export async function sampleAudioFor(
  ref: string,
  asTable: boolean,
  load: LoadSample,
  sampleRate: number,
): Promise<SampleAudio | null> {
  if (!asTable) return load(ref);
  const table = await tableFor(ref, load);
  return table && { channels: [table], rate: sampleRate };
}

const tableFrom = (cycles: Float32Array[] | undefined) => (cycles?.length ? tableOf(cycles) : null);

async function tableFor(ref: string, load: LoadSample): Promise<Float32Array | null> {
  const parsed = parseRef(ref);
  if (parsed.kind !== "wavetable") {
    const audio = await load(ref);
    return tableFrom(audio ? cyclesOf(audio.channels[0]) : undefined);
  }
  if (!builtinTables.has(parsed.id)) builtinTables.set(parsed.id, tableFrom(builtinWavetable(parsed.id)));
  return builtinTables.get(parsed.id) ?? null;
}
