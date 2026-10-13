/**
 * What taking something from Explore does, each one authored edit: the row's "+" and the panels'
 * Add buttons go through these. Choosing what to take happens in the panels first (`panelFor`), so
 * nothing here runs from a plain tap.
 */
import type { ProjectStore } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import { newEffectId, newMidiDeviceId, newTrackId } from "../../audio/commands/ids";
import { soundChains } from "../../audio/patches/sound";
import type { Patch } from "../../audio/patches/library";

const patchChains = (patch: Patch) => soundChains(patch);

export type LibraryActions = ReturnType<typeof useLibraryActions>;

export function useLibraryActions(projectStore: ProjectStore, dispatch: Dispatch) {
  const addInstrument = (type: string) => dispatch({ type: "createTrack", instrumentType: type, id: newTrackId() });
  const addPatch = (patch: Patch) =>
    dispatch({ type: "createTrackFromPatch", id: newTrackId(), ...patchChains(patch) });

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
