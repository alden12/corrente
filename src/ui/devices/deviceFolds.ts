/**
 * Which devices, and which of their sections, are folded in the rack (DAW-61.3). How you are
 * looking, not an edit: kept on this device, never a command, so folding a device never folds it
 * on a collaborator's screen. A device with sections starts open with them folded, so a big
 * instrument opens as a row of section names to pick from; one without starts folded. What you
 * change is remembered.
 */
import type { ParamSchema } from "../../audio/params/types";
import { sectionTitle, toSections } from "../paramSections";
import { usePersistentSet } from "../usePersistent";

/** Enough for every device in a big project, without keeping the ids of long-deleted ones for ever. */
const REMEMBERED = 500;

/**
 * A section's title in a device, which is what folds it, or "" where it has none: a device's only
 * section is the whole device, and one named for the device (a Delay's `delay.`) would only repeat it.
 */
export const sectionHeading = (label: string, sectionCount: number, namespace: string): string => {
  const named = sectionTitle(namespace);
  return sectionCount > 1 && named.toLowerCase() !== label.toLowerCase() ? named : "";
};

/**
 * Whether a device starts open: one with sections to fold does, showing their names to pick from;
 * one without (a single section, or none titled) starts folded, as it has nothing smaller to fold to.
 */
export const startsOpen = (label: string, schema: ParamSchema): boolean => {
  const sections = toSections(schema);
  return sections.some((section) => sectionHeading(label, sections.length, section.namespace) !== "");
};

/**
 * The devices folded and opened away from how they start (`startsOpen`), by key: kept as two lists,
 * so a device's start can change without flipping what you chose.
 */
export function useDeviceFolds() {
  const [folded, , putFolded] = usePersistentSet("corrente:device-folds", REMEMBERED);
  const [opened, , putOpened] = usePersistentSet("corrente:devices-opened", REMEMBERED);
  const isOpen = (key: string, opensAtStart: boolean) =>
    opened.has(key) ? true : folded.has(key) ? false : opensAtStart;
  /** Fold (or open) every key in `keys`, as the devices' menu does. */
  const putAll = (keys: readonly string[], fold: boolean) => {
    putFolded(keys, fold);
    putOpened(keys, !fold);
  };
  return {
    isOpen,
    /** Whether `key` has been folded or opened by hand, rather than being as it starts. */
    isChosen: (key: string) => opened.has(key) || folded.has(key),
    toggle: (key: string, opensAtStart: boolean) => putAll([key], isOpen(key, opensAtStart)),
    putAll,
  };
}

/** The sections you've opened, by `sectionFold` key: they start folded, so it's the open ones kept. */
export const useOpenSections = () => usePersistentSet("corrente:device-sections-open", REMEMBERED);

/** A section's fold key, within its device's. */
export const sectionFold = (deviceKey: string, namespace: string) => `${deviceKey}/${namespace}`;

/** An instrument's fold key: one per track, as a track has one instrument. */
export const instrumentFold = (trackId: string) => `instrument:${trackId}`;
