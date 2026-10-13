/**
 * Which group cards are open on the project page, kept on this device. Cards start closed, so a
 * busy project opens as a short list of groups; opening one is remembered. Separate from the
 * arrangement's own group collapse (a project value every collaborator shares; DAW-49 plans a
 * per-device one there too), so opening a card here never opens the timeline's group.
 */
import { useSyncExternalStore } from "react";
import { readPersistent, subscribePersistent, writePersistent } from "../persistentStore";

const KEY = "corrente:project-groups-open";

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(readPersistent(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** The open group ids, and a toggle for one of them. */
export function useOpenGroups(): [Set<string>, (groupId: string) => void] {
  const raw = useSyncExternalStore(
    (listener) => subscribePersistent(KEY, listener),
    () => readPersistent(KEY),
  );
  const open = new Set(raw === null ? [] : read());
  const toggle = (groupId: string) => {
    const next = new Set(read());
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    writePersistent(KEY, JSON.stringify([...next]));
  };
  return [open, toggle];
}
