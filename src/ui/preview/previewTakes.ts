/**
 * The ways your preview reaches the rest of the project (COMM-1.4.5): copied as a new track, or onto
 * a track, replacing its sound or adding just the devices tried. Each is one edit, after which that
 * track is the one shown, and the preview stays, to keep trying things. Using it counts the item it came from as used (Recently used).
 */
import type { Dispatch } from "../../audio/commands/types";
import type { InstrumentTrack, ProjectStore } from "../../audio/project/projectStore";
import { newTrackId } from "../../audio/commands/ids";
import { soundChains, trackSound, type Sound } from "../../audio/patches/sound";
import type { MenuItem } from "../Menu";
import { noteUsed } from "../explore/recent/store";
import { triedItem } from "./previewTrying";
import { paletteAccent } from "../deviceColor";

export function previewTakes(
  preview: InstrumentTrack,
  projectStore: ProjectStore,
  dispatch: Dispatch,
  /** Wraps each, so a host can get out of the way after it (the phone goes to the Studio). */
  around: (act: () => void) => void = (act) => act(),
) {
  const taking = (act: (sound: Sound) => void) => () =>
    around(() => {
      act(trackSound(preview, projectStore));
      const tried = triedItem.read();
      if (tried) noteUsed(tried);
    });
  // Then that track is the one shown, as a new track is: what changed is there.
  const replaceOn = (track: InstrumentTrack) =>
    taking((sound) => {
      dispatch({ type: "applyPatch", trackId: track.id, ...soundChains(sound) });
      projectStore.selectTrack(track.id);
    });
  // Its devices after the track's own, MIDI devices and effects each at the end of their chain:
  // the track's sound stays, with these added. One edit, as Replace is.
  const addDevicesTo = (track: InstrumentTrack) =>
    taking((sound) => {
      const own = soundChains(trackSound(track, projectStore));
      const tried = soundChains(sound);
      dispatch({
        type: "applyPatch",
        trackId: track.id,
        ...own,
        midiDevices: [...own.midiDevices, ...tried.midiDevices],
        effects: [...own.effects, ...tried.effects],
        // The track's own custom devices, and the custom effects this brings.
        ...(own.devices || sound.devices?.effects
          ? {
              devices: {
                ...own.devices,
                effects: [...(own.devices?.effects ?? []), ...(sound.devices?.effects ?? [])],
              },
            }
          : {}),
      });
      projectStore.selectTrack(track.id);
    });
  const hasDevices = preview.effects.length > 0 || preview.midiDevices.length > 0;
  return {
    /** A new track playing it, in `groupId` (else the main group). */
    createTrack: (groupId?: string) =>
      taking((sound) =>
        dispatch({
          type: "createTrackFromPatch",
          id: newTrackId(),
          ...(groupId ? { groupId } : {}),
          ...soundChains(sound),
        }),
      ),
    /** The "Use on" menu: each instrument track, to replace its sound or add just the devices tried. */
    useOnItems: (): MenuItem[] =>
      projectStore
        .getTracks()
        .filter((track): track is InstrumentTrack => track.kind === "instrument")
        .map((track) => ({
          label: track.name,
          swatch: paletteAccent(track.color),
          submenu: [
            { label: "Replace its sound", onClick: replaceOn(track) },
            { label: "Add just the devices", onClick: addDevicesTo(track), disabled: !hasDevices },
          ],
        })),
  };
}
