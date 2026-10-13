/**
 * A sound: an instrument with its parameter values and its MIDI-device and effect chains, and a
 * name. A patch is one (plus its library metadata), a bare instrument is one with default values,
 * and so is whatever is being tried in Explore after its knobs were turned (COMM-1.4.1).
 */
import { newEffectId, newMidiDeviceId } from "../commands/ids";
import type { Patch } from "./library";

export type Sound = Pick<Patch, "name" | "instrumentType" | "params" | "effects" | "midiDevices">;

/** A bare instrument as a sound: its schema defaults apply, nothing in its chains. */
export const instrumentSound = (instrumentType: string, name: string): Sound => ({
  name,
  instrumentType,
  params: {},
  effects: [],
  midiDevices: [],
});

/**
 * A sound's chains with fresh ids, for a `createTrackFromPatch` or `applyPatch` edit. Minted here
 * and carried in the command, so undo/redo and history replay reproduce the same track exactly.
 */
export const soundChains = (sound: Sound) => ({
  name: sound.name,
  instrumentType: sound.instrumentType,
  params: sound.params,
  midiDevices: (sound.midiDevices ?? []).map((device) => ({
    id: newMidiDeviceId(),
    type: device.type,
    bypassed: device.bypassed,
    params: device.params,
  })),
  effects: sound.effects.map((effect) => ({
    id: newEffectId(),
    type: effect.type,
    bypassed: effect.bypassed,
    params: effect.params,
  })),
});
