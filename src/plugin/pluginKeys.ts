/**
 * The keys in the plugin's window (PLUGIN-3.11): the app's keys panel, playing the plugin. What its
 * pads and the computer keyboard play goes to the plugin as notes, which it plays through the
 * device as it does the host's. They don't go out to the host, so it can't record them: Live
 * doesn't take a VST3 instrument's MIDI out.
 *
 * Who has the computer keyboard (`keyboardTaken`) follows the keys' fold: open, the window has it, so
 * its keys play from it and the page stops handing it back after each click (`keysToHost`); folded,
 * the host has it, which plays notes from it (Ableton's computer MIDI keyboard).
 */
import { LiveNotes } from "../audio/live/liveNotes";
import { createValueStore } from "../listeners";
import type { ToPlugin } from "./pluginDevice";

/** The velocity a key with none plays at: the computer keyboard's, as the app's instruments default it. */
const DEFAULT_VELOCITY = 0.8;
/** Stands in for the track's id: the window plays its one track. */
const TRACK = "plugin";

/** Notes for the plugin, as the keys panel plays them. */
export const pluginNotes = (send: (message: ToPlugin) => void): LiveNotes => {
  const target = {
    noteOn: (note: number, velocity = DEFAULT_VELOCITY) => send({ type: "note", note, velocity }),
    noteOff: (note: number) => send({ type: "note", note, velocity: 0 }),
  };
  // Nothing records here: the host does, from the notes the plugin sends out.
  const recorder = { noteOn: () => {}, noteOff: () => {} };
  return new LiveNotes({ getNoteTarget: () => target }, { selectedId: TRACK }, recorder);
};

/** Whether the window has the computer keyboard rather than the host. */
export const keyboardTaken = createValueStore(false);
