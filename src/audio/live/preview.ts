/**
 * The sound being tried in Explore (COMM-1.4.1): playable from the keys and pads, and never part
 * of the project until it is added.
 *
 * It lives in a scratch `ProjectStore` holding one track, so building it uses exactly the path a
 * real track takes (schema defaults, coerced values, MIDI devices and effects), and the engine
 * plays that track on its own (`AudioEngine.setPreview`). The scratch store is thrown away on
 * close: nothing is saved, nothing is an edit, nothing reaches history.
 *
 * `current()` is the sound as it stands, which is what Add, Swap and a recorded take carry into
 * the project.
 */
import { ProjectStore, type InstrumentTrack } from "../project/projectStore";
import { soundChains, type Sound } from "../patches/sound";
import type { InstrumentTarget } from "./liveNotes";

export interface PreviewEngine {
  setPreview(track: InstrumentTrack | null): void;
  getPreviewTarget(): InstrumentTarget | undefined;
  /** Explore's sample panel: hear a sample once, and know how long it is to place it. */
  playSample(ref: string): Promise<number | null>;
  stopSample(): void;
  sampleDuration(ref: string): Promise<number | null>;
}

export interface PreviewState {
  /** Which Explore item is being tried, so its row can show it. */
  key: string;
  name: string;
  /** The scratch track it plays from. */
  track: InstrumentTrack;
}

const PREVIEW_TRACK_ID = "preview";

export class SoundPreview {
  private state: PreviewState | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly engine: PreviewEngine;
  private readonly onTaken: (key: string) => void;

  /** `onTaken` hears which item's sound reached the project (Explore's Recently used, COMM-1.9.7). */
  constructor(engine: PreviewEngine, onTaken: (key: string) => void = () => undefined) {
    this.engine = engine;
    this.onTaken = onTaken;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PreviewState | null => this.state;

  /** Try a sound, replacing whatever was being tried. */
  open(key: string, sound: Sound): void {
    const scratch = new ProjectStore(false);
    const track = scratch.addTrackFromPatch({ id: PREVIEW_TRACK_ID, ...soundChains(sound) });
    if (track.kind !== "instrument") return;
    this.engine.setPreview(track);
    this.set({ key, name: sound.name, track });
  }

  /** The sound went into the project (added, swapped on, or recorded with): say so, and stop trying. */
  taken(): void {
    if (this.state) this.onTaken(this.state.key);
    this.close();
  }

  close(): void {
    if (!this.state) return;
    this.engine.setPreview(null);
    this.set(null);
  }

  /** Hear a sample once (Explore's sample panel); it is not a sound to play from the keys. */
  playSample = (ref: string): Promise<number | null> => this.engine.playSample(ref);
  stopSample = (): void => this.engine.stopSample();
  sampleDuration = (ref: string): Promise<number | null> => this.engine.sampleDuration(ref);

  /** Where live notes go while trying, or undefined when nothing is. */
  get target(): InstrumentTarget | undefined {
    return this.state ? this.engine.getPreviewTarget() : undefined;
  }

  /** The sound as it stands now; null when nothing is being tried. */
  current(): Sound | null {
    const track = this.state?.track;
    if (!track) return null;
    return {
      name: this.state!.name,
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

  private set(state: PreviewState | null): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
