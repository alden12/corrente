/**
 * What taking something from Explore does, each one authored edit: the row's "+" and the panels'
 * Add buttons go through these. Choosing what to take happens in the panels first (`panelFor`), so
 * nothing here runs from a plain tap. In the plugin's one-track window (`ExploreScope`), a sound
 * replaces the selected track's instead of adding a track.
 */
import type { ProjectStore } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import { newEffectId, newMidiDeviceId, newTrackId } from "../../audio/commands/ids";
import { catalogEntry } from "../../audio/instruments/catalog";
import { instrumentSound, soundChains, type Sound } from "../../audio/patches/sound";
import type { Patch } from "../../audio/patches/library";
import { useExploreScope } from "./exploreScope";

const patchChains = (patch: Patch) => soundChains(patch);

export type LibraryActions = ReturnType<typeof useLibraryActions>;

export function useLibraryActions(projectStore: ProjectStore, dispatch: Dispatch) {
  const { oneTrack } = useExploreScope();
  /** The plugin's way to take a sound: onto the selected track, in place of what it plays. */
  const replace = (sound: Sound) => {
    const trackId = projectStore.selectedId;
    if (trackId) dispatch({ type: "applyPatch", trackId, ...soundChains(sound) });
  };
  const addInstrument = (type: string) =>
    oneTrack
      ? replace(instrumentSound(type, catalogEntry(type).label))
      : dispatch({ type: "createTrack", instrumentType: type, id: newTrackId() });
  const addPatch = (patch: Patch) =>
    oneTrack ? replace(patch) : dispatch({ type: "createTrackFromPatch", id: newTrackId(), ...patchChains(patch) });

  return {
    addInstrument,
    addPatch,
    addEffect: (type: string) => {
      const hostId = projectStore.selectedId;
      if (hostId) dispatch({ type: "addEffect", hostId, effectType: type, id: newEffectId() });
    },
    addMidiDevice: (type: string) => {
      const trackId = projectStore.selectedId;
      if (trackId) dispatch({ type: "addMidiDevice", trackId, deviceType: type, id: newMidiDeviceId() });
    },
  };
}
