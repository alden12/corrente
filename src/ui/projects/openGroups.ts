/**
 * Which group cards are open on the project page, kept on this device. Cards start closed, so a
 * busy project opens as a short list of groups; opening one is remembered. Separate from the
 * arrangement's own group collapse (a project value every collaborator shares; DAW-49 plans a
 * per-device one there too), so opening a card here never opens the timeline's group.
 */
import { usePersistentSet } from "../usePersistent";

/** The open group ids, and a toggle for one of them. */
export const useOpenGroups = () => usePersistentSet("corrente:project-groups-open");
