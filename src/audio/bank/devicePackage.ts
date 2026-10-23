/**
 * A device as a package (PLUGIN-3): everything a host with no JavaScript needs to play one track's
 * chain, as the plugin saves it with the DAW's project and loads it again with its window closed.
 *
 * - **The plan and its binding** (binding.ts), as the bank hands them to the engine.
 * - **Every value the binding reads**, in its order: a param (its spec, a title to show, and its
 *   engine value now), a sample (its audio, embedded), or a fixed number (an effect's bypass).
 * - **Samples are embedded** (decided on PLUGIN-3, 2026-10-23): a sample as its original file's bytes,
 *   which the plugin decodes, and a wavetable as the band-limited table the app builds, which the
 *   plugin can't build yet. So a saved song plays wherever it's opened.
 *
 * Binary data is base64, so a package is plain JSON. DOM-free: the page and Node both make them, each
 * passing in how it reads a sample's bytes.
 */
import type { ParamSpec } from "../params/types";
import { engineValueOf } from "../definitions/values";
import { bindingOf } from "./binding";
import type { ChainPlan } from "./chainPlan";

/** The package format's version, for the plugin to refuse one it can't read. */
export const PACKAGE_FORMAT = 1;

/** One value of the binding, by what it is. */
export type PackageValue =
  | { kind: "param"; name: string; title: string; spec: ParamSpec; raw: number }
  | { kind: "sample"; name: string; ref: string; file?: string; table?: string }
  | { kind: "fixed"; name: string; raw: number };

export interface DevicePackage {
  format: typeof PACKAGE_FORMAT;
  label: string;
  /** The plan, as eng_load reads it. */
  words: number[];
  /** eng_bind's words up to the values (binding.ts). */
  binding: number[];
  values: PackageValue[];
}

/** Where a package's samples come from: a sample ref's file bytes, or its wavetable's table. */
export interface PackageSamples {
  file: (ref: string) => Promise<Uint8Array | null>;
  table: (ref: string) => Promise<Float32Array | null>;
}

/** Bytes as base64, in chunks: a whole sample at once would overflow the call's arguments. */
export const toBase64 = (bytes: Uint8Array): string => {
  const CHUNK = 0x8000;
  const parts = Array.from({ length: Math.ceil(bytes.length / CHUNK) }, (_, index) =>
    String.fromCharCode(...bytes.subarray(index * CHUNK, (index + 1) * CHUNK)),
  );
  return btoa(parts.join(""));
};

/**
 * A chain's package: `titleOf` names each param as the host lists it, and `fixed` gives the plan
 * params no store holds (each effect's bypass, 0 when absent).
 */
export const devicePackage = async (
  chain: ChainPlan,
  label: string,
  samples: PackageSamples,
  titleOf: (id: string, spec: ParamSpec) => string,
  fixed: Record<string, number> = {},
): Promise<DevicePackage> => {
  const { plan, sources } = chain;
  const binding = bindingOf(plan);
  const tables = new Set(plan.params.filter((source) => source.wavetable).map((source) => source.param));
  const valueOf = async (name: string, index: number): Promise<PackageValue> => {
    const source = sources[name];
    if (!source) return { kind: "fixed", name, raw: fixed[name] ?? 0 };
    const spec = source.store.spec(source.id);
    const value = source.store.get(source.id);
    if (!binding.samples[index]) {
      return { kind: "param", name, title: titleOf(source.id, spec), spec, raw: engineValueOf(spec, value) };
    }
    const ref = String(value);
    if (!ref) return { kind: "sample", name, ref };
    if (tables.has(name)) {
      const table = await samples.table(ref);
      const bytes = table && new Uint8Array(table.buffer, table.byteOffset, table.byteLength);
      return { kind: "sample", name, ref, ...(bytes ? { table: toBase64(bytes) } : {}) };
    }
    const file = await samples.file(ref);
    return { kind: "sample", name, ref, ...(file ? { file: toBase64(file) } : {}) };
  };
  return {
    format: PACKAGE_FORMAT,
    label,
    words: Array.from(plan.words),
    binding: binding.words,
    values: await Promise.all(binding.names.map(valueOf)),
  };
};
