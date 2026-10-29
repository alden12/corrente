/**
 * What a MIDI device plays from a short input, as notes (COMM-1.9.2): the phrase its Explore
 * portrait draws. Played on the engine itself (INST-52), the same chain a track plays, so a device
 * that is only data (a built-in, or one Claude made) draws what it really does. DOM-free and
 * synchronous: the bank renders block after block, and nothing waits in real time.
 *
 * **The input depends on the device.** A generator (one with a clock: an arpeggiator, a Euclidean)
 * is fed a held chord, which it turns into rhythm. A device that changes the notes it's given does
 * nothing a held chord can show, so it is fed a short melody, with a note out of the key, then a
 * short chord: enough for an octaver's copies, a quantiser's snapping, a harmoniser's stacks and a
 * strum's roll to show.
 */
import { EngineBank } from "../bank/bank";
import { BLOCK } from "../bank/exports";
import { compileDefinition } from "../definitions/compile";
import { chainWords } from "../midi/compile";
import { midiDeviceCatalogEntry } from "../midi/device/catalog";
import { engineMidiPlan, engineParamValue } from "../midi/engine";
import { NODE_SPECS } from "../midi/format";
import { ParamStore } from "../params/store";
import type { ParamValue } from "../params/types";
import type { PhraseNote } from "./draw";

/** A C major triad on middle C (C4 = MIDI 60). */
const CHORD = [60, 64, 67];
/** C, E flat (out of C major), G: a short line before the chord. */
const MELODY = [60, 63, 67];
const TEMPO = 120;
const SECONDS_PER_BEAT = 60 / TEMPO;
const RATE = 48000;

/** No sound, just voices for the notes to go to: what plays is read off the chain, not heard. */
const silentPlan = compileDefinition({
  format: 1,
  voices: 8,
  nodes: { out: { block: "mul", voice: true, inputs: { a: "voice.gate", b: 0 } } },
  voice: "out",
});

/** A key going down and coming up, in seconds. */
type Played = { pitch: number; start: number; end: number };

/** What the device is fed: a held chord for a generator, else a melody then a chord. */
const inputFor = (generates: boolean, spanSec: number): Played[] => {
  if (generates) return CHORD.map((pitch) => ({ pitch, start: 0, end: spanSec }));
  // Every note as short as the melody's, the chord's too: held for the rest of the phrase, each of its
  // notes drew as a long bar, and a strum's roll was a sliver at the start of it.
  const step = spanSec / 2 / MELODY.length;
  const length = step * 0.85;
  return [
    ...MELODY.map((pitch, index) => ({ pitch, start: index * step, end: index * step + length })),
    ...CHORD.map((pitch) => ({ pitch, start: spanSec / 2, end: spanSec / 2 + length })),
  ];
};

export function capturePhrase(
  type: string,
  engine: BufferSource,
  // Half a bar: at card size a whole bar of eighths is a row of slivers, and half shows the
  // pattern with notes wide enough to read.
  { bars = 0.5, params = {} }: { bars?: number; params?: Record<string, ParamValue> } = {},
): { notes: PhraseNote[]; spanSec: number } {
  const spanSec = bars * 4 * SECONDS_PER_BEAT;
  const plan = engineMidiPlan(type);
  if (!plan) return { notes: [], spanSec };
  const store = new ParamStore(midiDeviceCatalogEntry(type).schema);
  Object.entries(params).forEach(([id, value]) => store.set(id, value));
  const values = Object.fromEntries(plan.params.map((param) => [param, engineParamValue(store, param)]));

  const bank = new EngineBank(engine, RATE, 1);
  bank.load(0, silentPlan);
  bank.setTransport({ time: 0, beat: 0, tempo: TEMPO, playing: true });
  bank.loadMidi(0, chainWords([{ plan, values, bypassed: false }]).words);
  const generates = plan.nodes.some((node) => NODE_SPECS[node.kind].name === "clock");
  inputFor(generates, spanSec).forEach(({ pitch, start, end }) => {
    bank.noteOn(0, pitch, 0.9, start);
    bank.noteOff(0, pitch, end);
  });

  // Each block's notes, as [time, pitch, on] in seconds.
  const blocks = Math.ceil((spanSec * RATE) / BLOCK);
  const events = Array.from({ length: blocks }, (_, block) => {
    bank.process((block * BLOCK) / RATE);
    return bank
      .midiPlayed(0)
      .map(({ offset, note, velocity }) => ({ time: (block * BLOCK + offset) / RATE, pitch: note, on: velocity > 0 }));
  }).flat();

  // Pair each note on with the next note off of its pitch; one still sounding lasts to the end.
  const notes = events.flatMap((event, at) => {
    if (!event.on || event.time >= spanSec) return [];
    const off = events.slice(at + 1).find((later) => !later.on && later.pitch === event.pitch);
    const end = Math.min(off?.time ?? spanSec, spanSec);
    return [{ pitch: event.pitch, start: event.time, length: end - event.time }];
  });
  return { notes, spanSec };
}
