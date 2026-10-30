/**
 * The built-in sample kit: pure data (ids + human names), DOM-free so the Node
 * MCP server and tests can import it without Web Audio or Vite. The actual bytes
 * (and their bundled URLs) live in the browser-only `builtinUrls.ts`; this file
 * is the single list the UI, MCP, and the Sampler iterate.
 *
 * A sample is referenced by a tagged string ("the ref"): "builtin:<id>" for a
 * sample shipped with the app, "asset:<id>" for one in the project's sample
 * library (imported), or "" for an empty slot. Keeping refs as opaque tagged
 * strings lets a single `sample` param kind serve both without the schema
 * knowing the catalog.
 *
 * An imported sample is an *asset record* (see SampleAsset): a stable id that
 * survives edits/re-encodes, carrying the human name and pointing at the current
 * content hash (the bytes in the OPFS blob store). References use the stable id,
 * never the content hash, so trimming or re-encoding a sample never breaks them.
 */
import type { Tag } from "../tags";

export interface BuiltinSample {
  /** Stable id, e.g. "kick". The ref is `builtin:${id}`. */
  id: string;
  /** Human-readable name for the picker and MCP. */
  name: string;
  /** General MIDI drum note this sound conventionally sits on; used to seed a drum kit
   *  pad's default note so the kit follows the GM drum map. */
  gmNote?: number;
}

/**
 * A project-library sample. `id` is stable (minted once at import); `contentHash`
 * is the current bytes (the OPFS blob key) and may change if the sample is later
 * edited. `source` records provenance ("import" now; a remote origin later).
 */
export interface SampleAsset {
  id: string;
  name: string;
  contentHash: string;
  source?: string;
}

// gmNote is the General MIDI drum number (unambiguous); the app displays it in C4 = 60
// octave numbering, so 36 shows as "C2", etc.

/** A set of built-in drum samples that belong together, on the General MIDI drum map. */
export interface BuiltinKit {
  id: string;
  name: string;
  /** What its patch is tagged in Explore (`tags.ts`). */
  tags: readonly Tag[];
  samples: BuiltinSample[];
}

/**
 * The built-in kits. **The first is the default**: a new Drum Kit's pads start on it. Each sample's
 * file is `assets/<id>.wav`; the house kit's are made by `assets/generate.mjs`, the 808's are rendered
 * from its voices (`kits/voices808.ts`) on the engine by `yarn kits`.
 */
export const BUILTIN_KITS: BuiltinKit[] = [
  {
    id: "house",
    name: "House",
    tags: ["percussion"],
    samples: [
      { id: "kick", name: "Kick", gmNote: 36 }, // Bass Drum 1
      { id: "snare", name: "Snare", gmNote: 38 }, // Acoustic Snare
      { id: "hat-closed", name: "Closed Hat", gmNote: 42 }, // Closed Hi-Hat
      { id: "hat-open", name: "Open Hat", gmNote: 46 }, // Open Hi-Hat
      { id: "clap", name: "Clap", gmNote: 39 }, // Hand Clap
      { id: "rim", name: "Rim", gmNote: 37 }, // Side Stick
      { id: "tom", name: "Tom", gmNote: 45 }, // Low Tom
    ],
  },
  // Synthesized from engine blocks (INST-9.1), in the classic drum machine's manner.
  {
    id: "808",
    name: "808",
    tags: ["percussion", "retro"],
    samples: [
      { id: "808-kick", name: "808 Kick", gmNote: 36 }, // Bass Drum 1
      { id: "808-snare", name: "808 Snare", gmNote: 38 }, // Acoustic Snare
      { id: "808-hat-closed", name: "808 Closed Hat", gmNote: 42 }, // Closed Hi-Hat
      { id: "808-hat-open", name: "808 Open Hat", gmNote: 46 }, // Open Hi-Hat
      { id: "808-clap", name: "808 Clap", gmNote: 39 }, // Hand Clap
      { id: "808-rim", name: "808 Rim", gmNote: 37 }, // Side Stick
      { id: "808-tom-low", name: "808 Low Tom", gmNote: 45 }, // Low Tom
      { id: "808-tom-mid", name: "808 Mid Tom", gmNote: 47 }, // Low-Mid Tom
      { id: "808-tom-high", name: "808 High Tom", gmNote: 50 }, // High Tom
      { id: "808-cowbell", name: "808 Cowbell", gmNote: 56 }, // Cowbell
    ],
  },
];

/** The kit a new Drum Kit's pads start on. */
export const DEFAULT_KIT = BUILTIN_KITS[0];

/** Every built-in sample, kit by kit: what the sample pickers and the MCP list. */
export const BUILTIN_SAMPLES: BuiltinSample[] = BUILTIN_KITS.flatMap((kit) => kit.samples);

/**
 * The built-in wavetables (INST-36.6): sets of single cycles a `wavetable` block morphs through, dark
 * to bright, made in dsp/wavetable.ts in this order. The ref is `wavetable:${id}`.
 */
export const BUILTIN_WAVETABLES: { id: string; name: string }[] = [
  { id: "classic", name: "Classic (sine to saw)" },
  { id: "harmonics", name: "Harmonics" },
  { id: "pulse", name: "Pulse" },
];

export type SampleRef =
  | { kind: "none" }
  | { kind: "builtin"; id: string }
  | { kind: "asset"; id: string }
  | { kind: "wavetable"; id: string };

/** Build the ref string for a built-in sample. */
export const builtinRef = (id: string): string => `builtin:${id}`;

/** Build the ref string for a built-in wavetable. */
export const wavetableRef = (id: string): string => `wavetable:${id}`;

/** Build the ref string for a project-library (imported) sample. */
export const assetRef = (id: string): string => `asset:${id}`;

/** Parse a tagged sample ref. Unknown/empty refs parse to `{ kind: "none" }`. */
export function parseRef(ref: string): SampleRef {
  if (ref.startsWith("builtin:")) return { kind: "builtin", id: ref.slice("builtin:".length) };
  if (ref.startsWith("asset:")) return { kind: "asset", id: ref.slice("asset:".length) };
  if (ref.startsWith("wavetable:")) return { kind: "wavetable", id: ref.slice("wavetable:".length) };
  return { kind: "none" };
}

/**
 * Human name for a ref, for labels. Built-ins resolve via the catalog; project
 * assets resolve via the passed library (the catalog is DOM-free and project-
 * agnostic, so the asset list is supplied by the caller).
 */
export function refLabel(ref: string, assets: SampleAsset[] = []): string {
  const parsed = parseRef(ref);
  if (parsed.kind === "builtin") {
    return BUILTIN_SAMPLES.find((sample) => sample.id === parsed.id)?.name ?? parsed.id;
  }
  if (parsed.kind === "asset") {
    return assets.find((asset) => asset.id === parsed.id)?.name ?? parsed.id;
  }
  if (parsed.kind === "wavetable") {
    return BUILTIN_WAVETABLES.find((table) => table.id === parsed.id)?.name ?? parsed.id;
  }
  return "None";
}
