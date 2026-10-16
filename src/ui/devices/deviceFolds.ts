/**
 * Which devices, and which of their sections, are folded in the rack (DAW-61.3). How you are
 * looking, not an edit: kept on this device, never a command, so folding a device never folds it
 * on a collaborator's screen. Everything starts open; what you fold is remembered.
 */
import { usePersistentSet } from "../usePersistent";

/** Enough for every device in a big project, without keeping the ids of long-deleted ones for ever. */
const REMEMBERED = 500;

/** The folded keys, and a toggle for one: a device's key, or its key and a section's (`sectionFold`). */
export const useDeviceFolds = () => usePersistentSet("corrente:device-folds", REMEMBERED);

/** A section's fold key, within its device's. */
export const sectionFold = (deviceKey: string, namespace: string) => `${deviceKey}/${namespace}`;

/** An instrument's fold key: one per track, as a track has one instrument. */
export const instrumentFold = (trackId: string) => `instrument:${trackId}`;
