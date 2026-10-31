/**
 * A sound: an instrument with its parameter values and its MIDI-device and effect chains, and a
 * name. A patch is one (plus its library metadata), a bare instrument is one with default values,
 * and so is whatever is being tried in Explore after its knobs were turned (COMM-1.4.1).
 */
import { newEffectId, newMidiDeviceId } from "../commands/ids";
import type { CustomDevice } from "../definitions/custom";
import type { InstrumentTrack, ProjectStore } from "../project/projectStore";
import type { Patch } from "./patch";

/**
 * The custom devices a sound plays, carried with it (COMM-1.11.1): a custom instrument or effect
 * lives in one project, so a sound made with one brings its definition to play anywhere else.
 */
export interface SoundDevices {
  instruments?: CustomDevice[];
  effects?: CustomDevice[];
}

export type Sound = Pick<Patch, "name" | "instrumentType" | "params" | "effects" | "midiDevices" | "devices">;

/** Where a track's custom devices live: its project. */
export type DeviceSource = Pick<ProjectStore, "customInstruments" | "customEffects">;

/** The custom devices a track plays, from its project; undefined when it plays none. */
export function soundDevicesOf(track: InstrumentTrack, project: DeviceSource): SoundDevices | undefined {
  const effectTypes = new Set(track.effects.map((effect) => effect.type));
  const instruments = project.customInstruments.filter((device) => device.type === track.instrumentType);
  const effects = project.customEffects.filter((device) => effectTypes.has(device.type));
  if (!instruments.length && !effects.length) return undefined;
  return { ...(instruments.length ? { instruments } : {}), ...(effects.length ? { effects } : {}) };
}

/** A track's sound as it stands, under `name`: its instrument, its chains' values, and its custom devices. */
export function trackSound(track: InstrumentTrack, project: DeviceSource, name: string = track.name): Sound {
  const devices = soundDevicesOf(track, project);
  return {
    ...(devices ? { devices } : {}),
    name,
    instrumentType: track.instrumentType,
    params: track.params.snapshot(),
    midiDevices: track.midiDevices.map((device) => ({
      type: device.type,
      bypassed: device.bypassed,
      params: device.params.snapshot(),
    })),
    effects: track.effects.map((effect) => ({
      type: effect.type,
      bypassed: effect.bypassed,
      params: effect.params.snapshot(),
    })),
  };
}

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
  ...(sound.devices ? { devices: sound.devices } : {}),
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
