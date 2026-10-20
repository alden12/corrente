/**
 * A patch: an instrument type plus its parameter values and MIDI-device and effect chains, captured
 * as a named, reusable preset (COMM-1.11). The shape and the pure helpers, with no store behind them,
 * so the servers can use them (library.ts is the device's library of them).
 *
 * A patch stores effects *without* instance ids - ids are per-track and are minted
 * fresh when a patch is applied (see `createTrackFromPatch`), so the same patch can
 * be dropped onto many tracks. Applying a patch is one authored edit, so it is
 * undoable, two-voice, and replayable like any other.
 */
import type { Author } from "../commands/types";
import type { PatchValues } from "../params/types";
import { randomUuid } from "../randomUuid";
import type { Tag } from "../tags";
import type { LibraryEntry } from "../library/backend";
import type { SoundDevices } from "./sound";

/** One effect in a saved patch: its type, bypass state, and parameter values. */
export interface PatchEffect {
  type: string;
  bypassed?: boolean;
  params: PatchValues;
}

/** One MIDI device in a saved patch (same idless shape as PatchEffect). */
export interface PatchMidiDevice {
  type: string;
  bypassed?: boolean;
  params: PatchValues;
}

/** A saved instrument preset: instrument + params + MIDI-device + effect chains, named by the user. */
export interface Patch {
  id: string;
  name: string;
  author: Author;
  instrumentType: string;
  params: PatchValues;
  effects: PatchEffect[];
  /** MIDI-device chain (note transforms). Optional: patches saved before this default to none. */
  midiDevices?: PatchMidiDevice[];
  createdAt: number;
  /** True for a shipped factory preset (read-only, in code - see factory.ts). */
  builtin?: boolean;
  /** What it sounds like: its role first ("pad"), then its character ("dark"). Any string. */
  tags?: readonly Tag[];
  /** Why it exists: the brief, the song, the part it was made for. Not how it sounds (that's tags). */
  description?: string;
  /** Which version of it this is: a library patch's count of saves. */
  version?: number;
  /** The custom devices it plays, carried so it plays in any project. */
  devices?: SoundDevices;
}

/** What a library version holds for a patch: its sound, without the library's metadata. */
export type PatchDocument = Pick<Patch, "instrumentType" | "params" | "effects" | "midiDevices" | "devices">;

/** A patch's library document. */
export const patchDocumentOf = (patch: Patch): PatchDocument => ({
  instrumentType: patch.instrumentType,
  params: patch.params,
  effects: patch.effects,
  midiDevices: patch.midiDevices ?? [],
  ...(patch.devices ? { devices: patch.devices } : {}),
});

/** A library entry as a patch: wherever it came from, this device's library or an account's. */
export const patchOf = ({ item, current }: LibraryEntry): Patch => ({
  id: item.id,
  name: item.name,
  author: current.author,
  createdAt: item.createdAt,
  version: item.version,
  tags: current.tags,
  ...(current.description ? { description: current.description } : {}),
  ...(current.document as PatchDocument),
});

/** A fresh patch id. */
export function newPatchId(): string {
  return `pt-${randomUuid().slice(0, 8)}`;
}
