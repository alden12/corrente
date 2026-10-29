import { describe, expect, it } from "vitest";
import { renderProject } from "../src/audio/render/renderProject";
import { nodeRenderSetup } from "../server/render/nodeRender";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { createMidiDevice } from "../src/audio/midi/device/registry";
import { midiDeviceSchema } from "../src/audio/midi/device/catalog";
import type { NoteTarget } from "../src/audio/midi/device/GraphMidiDevice";
import { ParamStore } from "../src/audio/params/store";
import type { ParamValue } from "../src/audio/params/types";

/**
 * The arpeggiator and Euclidean in the engine (INST-11.2) play what their TypeScript strategies
 * played: a chord held through each, rendered, sounds sample for sample like the notes the TypeScript
 * device gives for it, written into a clip. Run from the transport's start, where the TypeScript
 * devices' steps (counted from the phrase) and the engine's (counted from the transport) agree. The
 * random walk is left out: the engine draws from its seed, not the TypeScript hash. Every note is a
 * sixteenth or longer, the shortest a clip keeps, so the clip plays what the device gave.
 */

const SECONDS_PER_BEAT = 0.5;
const CHORD = [60, 64, 67];
/** How long the chord is held, in beats. */
const HELD = 8;

/** Two and a half bars at 120 (a beat is half a second), with one subtractive track. */
const projectWith = (notes: { pitch: number; start: number; length: number; velocity: number }[]) => {
  const store = new ProjectStore(false);
  store.setTempo(120);
  store.setLength(10);
  const track = store.addTrack("subtractive") as InstrumentTrack;
  notes.forEach((note) => track.clips[0].store.addNote(note));
  return { store, track };
};

/** The notes today's TypeScript device plays for the chord, in beats. */
const typescriptNotes = (type: string, params: Record<string, ParamValue>) => {
  const notes: { pitch: number; start: number; length: number; velocity: number }[] = [];
  const recorder: NoteTarget = {
    noteOn: () => {},
    noteOff: () => {},
    playNote: (pitch, length, velocity = 1, when = 0) =>
      void notes.push({ pitch, start: when / SECONDS_PER_BEAT, length: length / SECONDS_PER_BEAT, velocity }),
    allNotesOff: () => {},
  };
  const clock = {
    playing: true,
    currentTime: 0,
    secondsPerBeat: SECONDS_PER_BEAT,
    continuousBeatAtTime: (time: number) => time / SECONDS_PER_BEAT,
    drivesSteps: true,
  };
  const store = new ParamStore(midiDeviceSchema(type));
  Object.entries(params).forEach(([id, value]) => store.set(id, value));
  const device = createMidiDevice(type, store, recorder, clock);
  CHORD.forEach((pitch) => device.playNote(pitch, HELD * SECONDS_PER_BEAT, 0.8, 0));
  device.scheduleWindow(0, HELD * SECONDS_PER_BEAT);
  device.dispose();
  return notes;
};

const render = (store: ProjectStore) => renderProject(store, nodeRenderSetup(), { tailSec: 1 });

const playsAsBefore = async (type: string, params: Record<string, ParamValue>) => {
  const { store, track } = projectWith(CHORD.map((pitch) => ({ pitch, start: 0, length: HELD, velocity: 0.8 })));
  const device = store.addMidiDevice(track.id, type)!;
  Object.entries(params).forEach(([id, value]) => device.params.set(id, value));
  const written = typescriptNotes(type, params);
  expect(written.length).toBeGreaterThan(0);
  const [engine, before] = await Promise.all([render(store), render(projectWith(written).store)]);
  const difference = engine.channels[0].reduce(
    (most, sample, index) => Math.max(most, Math.abs(sample - before.channels[0][index])),
    0,
  );
  expect(difference).toBeLessThan(1e-4);
};

const arpeggios = ["up", "down", "updown"].flatMap((pattern) =>
  [1, 2].flatMap((octaves) => ["1/4", "1/8"].map((rate) => ({ pattern, octaves, rate, gate: 0.5 }))),
);

const rhythms = [
  { steps: 8, pulses: 3, rotate: 0, accent: 0, repeats: 1, voicing: "chord", rate: "1/4" },
  { steps: 8, pulses: 3, rotate: 2, accent: 0.4, repeats: 1, voicing: "chord", rate: "1/4" },
  { steps: 8, pulses: 5, rotate: 0, accent: 0.4, repeats: 2, voicing: "up", rate: "1/4" },
  { steps: 16, pulses: 5, rotate: 3, accent: 0, repeats: 1, voicing: "updown", rate: "1/8" },
  { steps: 7, pulses: 4, rotate: 1, accent: 0.25, repeats: 2, voicing: "down", rate: "1/4" },
].map((rhythm) => ({ ...rhythm, gate: 0.5 }));

describe("the engine's arpeggiator and Euclidean play as the TypeScript ones did", () => {
  it.each(arpeggios)("arpeggiator %o", (params) => playsAsBefore("arpeggiator", params), 30000);
  it.each(rhythms)("euclidean %o", (params) => playsAsBefore("euclidean", params), 30000);
});
