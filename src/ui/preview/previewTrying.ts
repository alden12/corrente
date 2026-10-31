/**
 * Trying things from Explore on your preview track (COMM-1.4.5): a sound becomes it, and an effect
 * or MIDI device goes on it, each an ordinary edit of the project, in its history. With nothing
 * being tried yet, a device goes on the selected track's sound, copied in, else on a plain synth.
 * Trying shows the preview: it is selected, so the keys play it and its editor is what shows.
 *
 * Yours is the one keyed by your user id, so collaborators each try their own.
 */
import type { Dispatch, EditCommand } from "../../audio/commands/types";
import type { InstrumentTrack, ProjectStore } from "../../audio/project/projectStore";
import { newEffectId, newMidiDeviceId } from "../../audio/commands/ids";
import { soundChains, trackSound, type Sound } from "../../audio/patches/sound";
import { isPreviewTrackId, previewTrackId } from "../../audio/project/previewTrack";
import type { PreviewSource } from "../../audio/recording/recorder";
import { noteUsed } from "../explore/recent/store";
import { createValueStore } from "../../listeners";
import { readCurrentUser } from "../currentUser";

/** A device tried on the preview: an effect, or a MIDI device. */
export type TriedDevice = { kind: "effect" | "midi"; type: string };

/** The command that puts a tried device on a track. */
const ADD_DEVICE: Record<TriedDevice["kind"], (trackId: string, type: string) => EditCommand> = {
  effect: (trackId, type) => ({ type: "addEffect", hostId: trackId, effectType: type, id: newEffectId() }),
  midi: (trackId, type) => ({ type: "addMidiDevice", trackId, deviceType: type, id: newMidiDeviceId() }),
};

/**
 * Which Explore item the preview's sound came from, so its row can say so and using it counts it as
 * used (Recently used, COMM-1.9.7). On this device only: a reload forgets it, and nothing needs it to.
 */
export const triedItem = createValueStore<string | null>(null);

/** Your preview track, if you have one. */
export const ownPreview = (project: ProjectStore): InstrumentTrack | undefined => project.getPreview(readCurrentUser());

export function previewTrying(project: ProjectStore, dispatch: Dispatch) {
  const owner = readCurrentUser();
  const id = previewTrackId(owner);
  const sound = (key: string, tried: Sound) => {
    dispatch({ type: "setPreview", owner, ...soundChains(tried), name: tried.name });
    triedItem.set(key);
    project.selectTrack(id);
  };
  return {
    /** Make the preview this sound. */
    sound,
    /** Put a device on the preview, starting it from `base` if there isn't one. */
    device: (device: TriedDevice, base: () => { key: string; sound: Sound }) => {
      if (!project.getPreview(owner)) {
        const start = base();
        sound(start.key, start.sound);
      }
      dispatch(ADD_DEVICE[device.kind](id, device.type));
      project.selectTrack(id);
    },
    /** Put it away. */
    discard: () => {
      dispatch({ type: "removePreview", owner });
      triedItem.set(null);
    },
  };
}

export type PreviewTrying = ReturnType<typeof previewTrying>;

/**
 * What a take records with your preview in front: its sound, onto a new track (`Recorder`), rather
 * than notes onto the preview, which never plays them. That counts as using what it came from.
 */
export const previewRecording = (project: ProjectStore): PreviewSource => ({
  current: () => {
    const track = project.getSelectedTrack();
    return track?.kind === "instrument" && isPreviewTrackId(track.id) ? trackSound(track, project) : null;
  },
  taken: () => {
    const tried = triedItem.read();
    if (tried) noteUsed(tried);
  },
});
