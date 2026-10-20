/**
 * Custom instruments and effects in the library (COMM-1.11, COMM-1.9.8). A device's type is its id
 * for good: every project that uses it holds a copy of one version, and every change you make to it,
 * in any project, is kept here as the next version. So the library always has your latest, and a
 * project whose copy differs can offer the update (`LibraryUpdate`), as published devices will.
 *
 * **The library first, then the project.** A device edit lands only once its version is hashed and
 * stored (`withLibraryRef`), and carries `{ version, hash }`, so the project records exactly which
 * version its copy is, through undo, redo and replay, and never one the library doesn't have.
 */
import type { Author } from "../commands/types";
import type { DeviceEdit } from "../mcp/protocol";
import { sameDevice, type CustomDevice, type CustomKind } from "../definitions/custom";
import type { DeviceRef } from "./backend";
import { libraryEntries, libraryEntry, saveItem, type LibraryEntry } from "./store";

export type { DeviceRef };

export const deviceRefOf = ({ current }: LibraryEntry): DeviceRef => ({ version: current.version, hash: current.hash });

/** Keep a device in the library, as a new version if it changed, and say which version it is. */
export async function keepDevice(kind: CustomKind, device: CustomDevice, author: Author): Promise<DeviceRef> {
  const entry = await saveItem({
    id: device.type,
    kind,
    name: device.label ?? device.type,
    author,
    document: device,
    createdAt: Date.now(),
  });
  return deviceRefOf(entry);
}

/** The edits that add or change a device, and which kind each is. */
export const DEVICE_EDIT_KINDS: Record<DeviceEdit["type"], CustomKind> = {
  addCustomInstrument: "instrument",
  updateCustomInstrument: "instrument",
  addCustomEffect: "effect",
  updateCustomEffect: "effect",
};

/**
 * A device edit ready to land: once its device is kept in the library, carrying which version it
 * is. Rejects if the library couldn't keep the device, and then the edit mustn't land: the project
 * would hold a device the library doesn't.
 */
export async function withLibraryRef(edit: DeviceEdit, author: Author): Promise<DeviceEdit> {
  return { ...edit, library: await keepDevice(DEVICE_EDIT_KINDS[edit.type], edit.def, author) };
}

/**
 * The newer version the library offers a project's copy of a device, if any: matched by hash where
 * the project knows which version its copy is (`ref`), by content where it doesn't. Only a newer one:
 * a library behind the project (an agent's edit made elsewhere, not yet synced here) mustn't offer
 * to take the project back.
 */
export function offeredUpdate(
  kept: LibraryEntry | undefined,
  here: CustomDevice | undefined,
  ref: DeviceRef | undefined,
): CustomDevice | undefined {
  if (!kept || kept.item.hiddenAt !== undefined || !here) return undefined;
  const latest = kept.current.document as CustomDevice;
  const current = ref
    ? ref.hash === kept.current.hash || kept.current.version <= ref.version
    : sameDevice(latest, here);
  return current ? undefined : latest;
}

/** The library's latest version of a device, unless it was deleted. */
export function libraryDevice(type: string): CustomDevice | undefined {
  const kept = libraryEntry(type);
  return kept && kept.item.hiddenAt === undefined ? (kept.current.document as CustomDevice) : undefined;
}

/** The library's devices of a kind, newest first. */
export const libraryDevices = (kind: CustomKind): CustomDevice[] =>
  libraryEntries(kind).map(({ current }) => current.document as CustomDevice);

/**
 * The settings moving from one version of a device to another would reset: params the newer one
 * no longer has, or has as another kind. Empty means the update keeps every value; a published
 * device will need the same check to say a version breaks what was made with the last (COMM-1.1).
 */
export function settingsReset(from: CustomDevice, to: CustomDevice): string[] {
  const kindOf = new Map(to.schema.map((param) => [param.id, param.kind]));
  return from.schema.filter((param) => kindOf.get(param.id) !== param.kind).map((param) => param.label);
}
