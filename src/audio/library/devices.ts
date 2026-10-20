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
import type { Author, EditCommand } from "../commands/types";
import type { CustomDevice, CustomKind } from "../definitions/custom";
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
const DEVICE_EDITS: Partial<Record<EditCommand["type"], CustomKind>> = {
  addCustomInstrument: "instrument",
  updateCustomInstrument: "instrument",
  addCustomEffect: "effect",
  updateCustomEffect: "effect",
};

/**
 * An edit ready to land: a device edit once its device is kept in the library, carrying which
 * version it is; any other edit as it is. Rejects if the library couldn't keep the device, and then
 * the edit mustn't land: the project would hold a device the library doesn't.
 */
export async function withLibraryRef(command: EditCommand, author: Author): Promise<EditCommand> {
  const kind = DEVICE_EDITS[command.type];
  if (!kind || !("def" in command)) return command;
  return { ...command, library: await keepDevice(kind, command.def, author) };
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
