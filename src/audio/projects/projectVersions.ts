/**
 * An exported project is a version in its history (HOST-23.2.1.2): it carries the project's id and
 * every edit, each with its own id, so opening one can tell how it relates to the project of the
 * same id on this device, and offer what fits rather than always making a copy.
 */
import type { EditEntry } from "../commands/types";
import type { ProjectData } from "../project/types";
import { canonicalJson, sha256Hex } from "../contentHash";

/**
 * How an opened file relates to the project of the same id here:
 * - `absent`: there isn't one (a restore, say after losing the device);
 * - `same`: the same version;
 * - `earlier`: an earlier version of it (the file's edits begin the local log);
 * - `newer`: the local project is an earlier version of the file;
 * - `diverged`: each has edits the other lacks.
 */
export type ImportRelation = "absent" | "same" | "earlier" | "newer" | "diverged";

/** An edit's identity. Logs from before edits had ids fall back to their order. */
export const editKeys = (log: readonly EditEntry[]): string[] => log.map((entry) => entry.id ?? `seq:${entry.seq}`);

const startsWith = (whole: readonly string[], start: readonly string[]) =>
  start.length <= whole.length && start.every((key, index) => whole[index] === key);

export function relationOf(local: readonly string[] | undefined, incoming: readonly string[]): ImportRelation {
  if (!local) return "absent";
  if (local.length === incoming.length && startsWith(local, incoming)) return "same";
  if (startsWith(local, incoming)) return "earlier";
  if (startsWith(incoming, local)) return "newer";
  return "diverged";
}

/** `Deep House Jam` -> `deep-house-jam`, for a file name any system accepts. */
export const fileStem = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "project";

/**
 * A short id for a version: of its last edit, or of the document when it has no edits yet. Two
 * exports of one version get the same one.
 */
export const versionHash = async (log: readonly EditEntry[], project: ProjectData): Promise<string> => {
  const last = editKeys(log).at(-1);
  const hex = await sha256Hex(new TextEncoder().encode(last ?? canonicalJson(project)));
  return hex.slice(0, 6);
};

const twoDigits = (value: number) => String(value).padStart(2, "0");

/** `deep-house-jam-2026-10-21-a3f9c2.daw.zip`: the name, the day it was exported (local time), the version. */
export const exportFileName = (name: string, date: Date, hash: string): string =>
  `${fileStem(name)}-${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}-${hash}.daw.zip`;
