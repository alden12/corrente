/**
 * What each kind of Explore item does when you take it, keyed by its source (the `ItemSource`
 * kinds), so a new kind of item is one entry per map rather than a branch in the row.
 */
import type { ExploreItem, ItemSource } from "./exploreItems";
import { instrumentSound, type Sound } from "../../audio/patches/sound";
import type { LibraryActions } from "./useLibraryActions";

type Handlers<Result> = {
  [Kind in ItemSource["kind"]]: (source: Extract<ItemSource, { kind: Kind }>, actions: LibraryActions) => Result;
};

/**
 * Which panel a tap opens under Explore. Every kind opens one: nothing reaches the project from a
 * plain tap, so you see what you picked before it changes anything.
 * - `try`: the try panel (COMM-1.4.1). Played from the keys and pads; Replace current / Add new.
 * - `add`: a device for the selected track, with its Add (and, later, a way to hear it, COMM-1.4.2).
 * - `sample`: play it once, or put it on an audio track.
 */
export type PanelKind = "try" | "add" | "sample";

const PANEL: Record<ItemSource["kind"], PanelKind> = {
  instrument: "try",
  patch: "try",
  effect: "add",
  midi: "add",
  sample: "sample",
};

export const panelFor = (item: ExploreItem): PanelKind => PANEL[item.source.kind];

/** What the try panel plays, for the kinds it opens. */
const SOUND: { [Kind in ItemSource["kind"]]?: (source: Extract<ItemSource, { kind: Kind }>, name: string) => Sound } = {
  instrument: (source, name) => instrumentSound(source.type, name),
  patch: (source) => source.patch,
};

/** The sound to try for an item, or undefined for kinds that are not tried. */
export const soundFor = (item: ExploreItem): Sound | undefined =>
  (SOUND[item.source.kind] as ((source: ItemSource, name: string) => Sound) | undefined)?.(item.source, item.name);

/** What the primary tap says it will do, for its tooltip and accessible description. */
export const PICK_HINT: Record<ItemSource["kind"], (name: string) => string> = {
  instrument: (name) => `Try ${name}: play it before it is in your project`,
  patch: (name) => `Try "${name}": play it before it is in your project`,
  effect: (name) => `Show ${name}, to add it to the selected track`,
  midi: (name) => `Show ${name}, to add it to the selected track`,
  sample: (name) => `Show "${name}", to hear it or put it on an audio track`,
};

/**
 * The row's "+", one click into the project: a new track for an instrument or patch, or onto the
 * selected track for an effect or MIDI device. Samples have none; their panel is the way in.
 */
const ADD: Partial<Handlers<void>> = {
  instrument: (source, actions) => actions.addInstrument(source.type),
  patch: (source, actions) => actions.addPatch(source.patch),
  effect: (source, actions) => actions.addEffect(source.type),
  midi: (source, actions) => actions.addMidiDevice(source.type),
};

/** What the "+" says it will do, for its tooltip and accessible name. */
export const ADD_HINT: Partial<Record<ItemSource["kind"], (name: string) => string>> = {
  instrument: (name) => `Add "${name}" as a new track`,
  patch: (name) => `Add "${name}" as a new track`,
  effect: (name) => `Add "${name}" to the selected track`,
  midi: (name) => `Add "${name}" to the selected track`,
};

/** `undefined` when the item has no "+". */
export const addFor = (source: ItemSource, actions: LibraryActions) => {
  const add = ADD[source.kind] as ((source: ItemSource, actions: LibraryActions) => void) | undefined;
  return add && (() => add(source, actions));
};
