/**
 * Check a device plays something sane before an agent reports it built (AGENT-4.8). An agent writing
 * a device can't hear it: one that validated but played NaN, silence or a runaway feedback loop used
 * to reach the person's ears first. This renders it alone (renderDevice) and looks for exactly
 * those faults, so the authoring tool can say what's wrong in the same turn.
 *
 * Problems are faults (no sound, numbers that aren't numbers, a runaway, a sound that never stops).
 * Warnings are worth fixing but are the author's call: DC offset, and a dense chord that clips,
 * since level is a knob (INST-46: the built-ins were trimmed for exactly that).
 */
import { engineDevice } from "../definitions/engineDevices";
import { renderDevice, type DeviceSpec, type RenderSetup, type Rendered } from "./renderDevice";

export interface DeviceCheck {
  ok: boolean;
  problems: string[];
  warnings: string[];
  /** One line for the tool's reply: "OK (peak -9 dBFS ...)" or what's wrong. */
  summary: string;
}

/** Quieter than this while a note is held is silence: -60 dBFS. */
const SILENT = 0.001;
/** Louder than this is a runaway, not a loud sound: +12 dBFS. */
const RUNAWAY = 4;
/**
 * A five-note chord this loud is hot enough to warn about: +6 dBFS. The master's soft clip (INST-46)
 * rounds off a little over full scale, and most built-ins' chords land between 0 and +6.
 */
const HOT_CHORD = 2;
/** A mean this far from zero is DC offset. */
const DC = 0.02;
/** Still this loud at the end of the tail, and not falling, is a sound that never stops: -40 dBFS. */
const STILL_SOUNDING = 0.01;
/** The windows the tail is measured in. */
const WINDOW_SEC = 0.25;
/** Long enough that an echo's repeats don't make a falling tail look steady. */
const STUCK_WINDOW_SEC = 1;

const NOTE = 60;
const HOLD_SEC = 1;
const TAIL_SEC = 3;
/** Five notes, as a pianist's two hands might hold: where summed voices clip. */
const CHORD = [48, 55, 60, 64, 67];

const dbfs = (level: number) => (level > 0 ? `${(20 * Math.log10(level)).toFixed(1)} dBFS` : "silence");

/** Both channels' samples from `from` to `to` seconds. */
const span = ({ channels, sampleRate }: Rendered, from: number, to = Infinity) =>
  channels.map((channel) =>
    channel.subarray(Math.floor(from * sampleRate), Math.min(channel.length, Math.floor(to * sampleRate))),
  );

const peakOf = (samples: Float32Array[]) =>
  samples.reduce((most, channel) => channel.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), most), 0);
const rmsOf = (samples: Float32Array[]) => {
  const count = samples.reduce((total, channel) => total + channel.length, 0);
  const sum = samples.reduce((total, channel) => channel.reduce((inner, sample) => inner + sample * sample, total), 0);
  return count > 0 ? Math.sqrt(sum / count) : 0;
};
const meanOf = (samples: Float32Array[]) => {
  const count = samples.reduce((total, channel) => total + channel.length, 0);
  return count > 0
    ? samples.reduce((total, channel) => channel.reduce((inner, sample) => inner + sample, total), 0) / count
    : 0;
};
const finite = ({ channels }: Rendered) => channels.every((channel) => channel.every(Number.isFinite));

/** How long after `from` the sound first stays under -60 dBFS, in seconds; undefined if it never does. */
function quietAfter(rendered: Rendered, from: number): number | undefined {
  const windows = Math.floor((rendered.channels[0].length / rendered.sampleRate - from) / WINDOW_SEC);
  const quiet = Array.from(
    { length: windows },
    (_, index) => peakOf(span(rendered, from + index * WINDOW_SEC, from + (index + 1) * WINDOW_SEC)) < SILENT,
  );
  const first = quiet.findIndex((_, index) => quiet.slice(index).every(Boolean));
  return first < 0 ? undefined : first * WINDOW_SEC;
}

/** Still sounding at the end of the tail, and not falling away. */
function stuck(rendered: Rendered): boolean {
  const end = rendered.channels[0].length / rendered.sampleRate;
  const last = rmsOf(span(rendered, end - STUCK_WINDOW_SEC));
  const before = rmsOf(span(rendered, end - 2 * STUCK_WINDOW_SEC, end - STUCK_WINDOW_SEC));
  return last > STILL_SOUNDING && last >= before * 0.9;
}

const summarise = (problems: string[], warnings: string[], fine: string): DeviceCheck => ({
  ok: problems.length === 0,
  problems,
  warnings,
  summary:
    problems.length > 0
      ? `PROBLEM: ${problems.join("; ")}${warnings.length ? `. Also: ${warnings.join("; ")}` : ""}`
      : `OK (${fine})${warnings.length ? `. Warning: ${warnings.join("; ")}` : ""}`,
});

/**
 * A note the instrument answers: middle C, or for one mapped in zones (a kit's pads), the low end of
 * its first zone's keys, as the device's params set them.
 */
function noteFor({ type, params = {} }: DeviceSpec): number {
  const spec = engineDevice(type);
  const low = spec?.definition.zones?.[0]?.keys?.[0];
  if (low === undefined) return NOTE;
  if (typeof low === "number") return low;
  const value = params[low.param] ?? spec?.schema.find((param) => param.id === low.param)?.default;
  return typeof value === "number" ? value : NOTE;
}

/** Hold a note it answers, let it go, then hold a five-note chord. */
export async function checkInstrument(instrument: DeviceSpec, setup: RenderSetup): Promise<DeviceCheck> {
  const seconds = HOLD_SEC + TAIL_SEC;
  const note = await renderDevice(
    { instrument },
    { kind: "notes", notes: [{ pitch: noteFor(instrument), start: 0, length: HOLD_SEC }] },
    seconds,
    setup,
  );
  const chord = await renderDevice(
    { instrument },
    { kind: "notes", notes: CHORD.map((pitch) => ({ pitch, start: 0, length: HOLD_SEC })) },
    HOLD_SEC + 0.5,
    setup,
  );
  if (!finite(note) || !finite(chord))
    return summarise(
      ["its output has NaN or infinite samples (a param bound where a number can't come from?)"],
      [],
      "",
    );

  const held = span(note, 0, HOLD_SEC);
  const notePeak = peakOf(held);
  const chordPeak = peakOf(chord.channels);
  const peak = Math.max(notePeak, peakOf(note.channels));
  const quiet = quietAfter(note, HOLD_SEC);
  const problems = [
    notePeak < SILENT && `silent: a held note peaks at ${dbfs(notePeak)}`,
    Math.max(peak, chordPeak) > RUNAWAY && `runaway: it peaks at ${dbfs(Math.max(peak, chordPeak))}`,
    stuck(note) && `it keeps sounding ${TAIL_SEC} s after the note is released (a stuck voice or feedback that grows?)`,
  ].filter((problem): problem is string => !!problem);
  const warnings = [
    Math.abs(meanOf(held)) > DC && `DC offset of ${meanOf(held).toFixed(3)}`,
    chordPeak > HOT_CHORD &&
      `a five-note chord peaks at ${dbfs(chordPeak)} and will clip hard; lower its level (a single note around -10 dBFS sits with the built-ins)`,
  ].filter((warning): warning is string => !!warning);
  const decay = quiet === undefined ? "" : `, quiet ${Math.round(quiet * 1000)} ms after release`;
  return summarise(
    problems,
    warnings,
    `a note peaks at ${dbfs(notePeak)}, a five-note chord at ${dbfs(chordPeak)}${decay}`,
  );
}

/** A click and a short tone burst through it, then its tail. */
export async function checkEffect(effect: DeviceSpec, setup: RenderSetup): Promise<DeviceCheck> {
  const seconds = TAIL_SEC + 0.5;
  const burst = await renderDevice(
    { effects: [effect] },
    { kind: "burst", frequency: 440, seconds: 0.2 },
    seconds,
    setup,
  );
  const impulse = await renderDevice({ effects: [effect] }, { kind: "impulse" }, seconds, setup);
  if (!finite(burst) || !finite(impulse))
    return summarise(
      ["its output has NaN or infinite samples (a param bound where a number can't come from?)"],
      [],
      "",
    );

  const peak = Math.max(peakOf(burst.channels), peakOf(impulse.channels));
  const quiet = quietAfter(burst, 0.2);
  const problems = [
    peak < SILENT && `silent: a tone burst through it comes out at ${dbfs(peak)}`,
    peak > RUNAWAY && `runaway: it peaks at ${dbfs(peak)}`,
    (stuck(burst) || stuck(impulse)) && `it keeps sounding ${TAIL_SEC} s after its input stops (feedback that grows?)`,
  ].filter((problem): problem is string => !!problem);
  const mean = meanOf(span(burst, 0, 0.2));
  const warnings = [Math.abs(mean) > DC && `DC offset of ${mean.toFixed(3)}`].filter(
    (warning): warning is string => !!warning,
  );
  const tail = quiet === undefined ? "" : `, quiet ${Math.round(quiet * 1000)} ms after its input stops`;
  return summarise(problems, warnings, `a tone burst comes out at ${dbfs(peakOf(burst.channels))}${tail}`);
}
