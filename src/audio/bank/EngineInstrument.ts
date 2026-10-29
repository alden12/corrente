/**
 * An instrument played by the new engine (INST-36.5): an `EngineDevice` at the first stage, taking
 * notes. It is an `Instrument` like any other, so the track, the scheduler and live input don't know
 * which engine plays it while both exist. Its plan may carry the engine effects after it too
 * (INST-36.7, chainPlan.ts), reloaded in place when they change.
 */
import type { Instrument } from "../instruments/types";
import type { ChainPlan } from "./chainPlan";
import { EngineDevice } from "./EngineDevice";
import { INSTRUMENT_STAGE } from "./stages";
import { EngineMidiChain } from "./midiChain";
import type { MidiDeviceSource } from "../midi/engine";

export class EngineInstrument extends EngineDevice implements Instrument {
  private readonly midi = new EngineMidiChain(
    (message) => this.send(message),
    () => this.context.currentTime,
  );

  constructor(context: BaseAudioContext, chain: ChainPlan) {
    super(context, chain, { stage: INSTRUMENT_STAGE });
  }

  /**
   * Play the notes through these MIDI devices in the engine, ahead of the voices (INST-11.1): every
   * one must be a device the engine plays (playsInEngine). None plays the notes as they come.
   */
  setMidiDevices(devices: readonly MidiDeviceSource[]): void {
    this.midi.set(devices);
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    this.send({ type: "noteOn", note: midi, velocity, time: when ?? this.context.currentTime });
  }

  noteOff(midi: number, when?: number): void {
    this.send({ type: "noteOff", note: midi, time: when ?? this.context.currentTime });
  }

  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    const start = when ?? this.context.currentTime;
    this.noteOn(midi, velocity, start);
    this.noteOff(midi, start + durationSec);
  }

  allNotesOff(): void {
    this.send({ type: "allOff", time: this.context.currentTime });
  }

  dispose(): void {
    this.midi.dispose();
    super.dispose();
  }
}
