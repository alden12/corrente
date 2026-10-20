/**
 * Custom instruments and effects in the library (COMM-1.11.1, COMM-1.9.8). A device's type is its
 * id for good: every project that uses it holds a copy of one version, and every change you make to
 * it, in any project, is kept here as the next version. So the library always has your latest, and a
 * project whose copy differs can offer the update (`LibraryUpdate`), as published devices will.
 */
import type { Author, EditCommand } from "../commands/types";
import { sameDevice, type CustomDevice, type CustomKind } from "../definitions/custom";
import { libraryEntries, libraryEntry, saveItem } from "./store";

/** Keep a device in the library, as a new version if it changed since it was last kept. */
export function keepDevice(kind: CustomKind, device: CustomDevice, author: Author): void {
  const kept = libraryEntry(device.type);
  if (kept && kept.item.hiddenAt === undefined && sameDevice(kept.current.document as CustomDevice, device)) return;
  const { written } = saveItem({
    id: device.type,
    kind,
    name: device.label ?? device.type,
    author,
    document: device,
    createdAt: Date.now(),
  });
  void written.catch(() => {}); // the queue has warned
}

/** The edits that add or change a device, and which kind each is. */
const DEVICE_EDITS: Partial<Record<EditCommand["type"], CustomKind>> = {
  addCustomInstrument: "instrument",
  updateCustomInstrument: "instrument",
  addCustomEffect: "effect",
  updateCustomEffect: "effect",
};

/** Keep the device an edit adds or changes: what the app does with every edit made on this device. */
export function keepDevicesOf(command: EditCommand, author: Author): void {
  const kind = DEVICE_EDITS[command.type];
  if (kind && "def" in command) keepDevice(kind, command.def, author);
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
