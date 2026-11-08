/**
 * Where a track's automation plays, and what it moves (DAW-67). Pure, so the scheduler, a render and
 * the knobs showing a live value all read the same answer.
 *
 * - **Runs**: each stretch of the arrangement an automation clip plays over. An unlinked clip runs
 *   at its own placements; a linked one wherever its note clip plays: that clip's placements, or the
 *   whole loop while it is launched. A launched clip takes the track over, so the arrangement's own
 *   automation rests, as its notes do. In a run the clip counts from the run's start (plus its
 *   offset), looping at its own length: a linked clip longer than its note clip spans its loops.
 * - **Moves**: the curve sampled on a grid of `stepBeats` across a window of the continuous count,
 *   each binding's value in its param's units. Where two runs cover a beat, the later-starting wins.
 */
import type { AutomationBinding, AutomationClipData, Placement } from "../project/types";
import { musicalBeat } from "../sequencer/timing";
import { clipValueAt } from "./curve";

/** What a track holds that automation plays from (the runtime track and its structure both fit). */
export interface AutomatedTrack {
  automations: readonly AutomationClipData[];
  automationPlacements: readonly Placement[];
  placements: readonly Placement[];
  launchedClipId: string | null;
}

export interface AutomationRun {
  clip: AutomationClipData;
  startBeat: number;
  length: number;
  /** Where in the clip the run starts. */
  offset: number;
  /** The automation placement it plays at; unset for a linked clip, which plays at its note clip's. */
  placementId?: string;
}

/** One knob's value at a beat of the continuous count: the binding, and the value in its units. */
export interface AutomationMove {
  automationId: string;
  binding: AutomationBinding;
  beat: number;
  value: number;
}

/** A binding's knob as one string: which device, and which param on it. Two clips on one knob share it. */
export const bindingKnob = (binding: Pick<AutomationBinding, "target" | "param">): string => {
  const { target } = binding;
  const device = target.kind === "effect" ? target.effectId : target.kind === "midiDevice" ? target.deviceId : "";
  return `${target.kind}:${device}:${binding.param}`;
};

/** The curve's 0..1 as a binding's value. */
export const boundValue = (binding: Pick<AutomationBinding, "min" | "max">, value: number): number =>
  binding.min + (binding.max - binding.min) * value;

/** Every run of a track's automation, latest-starting last. */
export function automationRuns(track: AutomatedTrack, loopStart: number, loopLength: number): AutomationRun[] {
  const notePlacements = track.launchedClipId
    ? [{ clipId: track.launchedClipId, startBeat: loopStart, offset: 0, length: loopLength }]
    : track.placements;
  return track.automations
    .flatMap((clip) => {
      const placements = clip.linkedClipId
        ? notePlacements.filter((placement) => placement.clipId === clip.linkedClipId)
        : track.launchedClipId
          ? []
          : track.automationPlacements.filter((placement) => placement.clipId === clip.id);
      return placements.map(({ startBeat, length, offset, ...placement }) => ({
        clip,
        startBeat,
        length,
        offset,
        ...(clip.linkedClipId === undefined && "id" in placement ? { placementId: placement.id } : {}),
      }));
    })
    .sort((left, right) => left.startBeat - right.startBeat);
}

/** The run playing at an arrangement beat (the latest-starting, if several), and where in its clip. */
export function runAt(runs: readonly AutomationRun[], beat: number): { run: AutomationRun; clipBeat: number }[] {
  return runs
    .filter((run) => beat >= run.startBeat && beat < run.startBeat + run.length)
    .map((run) => ({ run, clipBeat: run.offset + beat - run.startBeat }));
}

/**
 * Each knob's value at an arrangement beat, by `bindingKnob`: the latest-starting run that drives it
 * and has a curve. What a knob shows while it plays.
 */
export function knobValuesAt(runs: readonly AutomationRun[], beat: number): Map<string, AutomationMove> {
  const values = new Map<string, AutomationMove>();
  for (const { run, clipBeat } of runAt(runs, beat)) {
    const value = clipValueAt(run.clip, clipBeat);
    if (value === undefined) continue;
    for (const binding of run.clip.bindings)
      values.set(bindingKnob(binding), { automationId: run.clip.id, binding, beat, value: boundValue(binding, value) });
  }
  return values;
}

/**
 * The moves across [fromBeat, toBeat) of the continuous count (0 the loop's start, a lead-in below
 * it), sampled every `stepBeats` on a grid from 0, so one window carries on where the last left off.
 * `beat` on each move is on the continuous count, for the caller to time.
 */
export function automationMoves(
  runs: readonly AutomationRun[],
  fromBeat: number,
  toBeat: number,
  loopStart: number,
  loopLength: number,
  stepBeats: number,
): AutomationMove[] {
  if (runs.length === 0 || stepBeats <= 0 || toBeat <= fromBeat) return [];
  const moves: AutomationMove[] = [];
  // `|| 0` turns the -0 that `Math.ceil` gives just below 0 into 0.
  for (let step = Math.ceil(fromBeat / stepBeats - 1e-9) || 0; step * stepBeats < toBeat; step++) {
    const beat = step * stepBeats;
    for (const move of knobValuesAt(runs, musicalBeat(beat, loopStart, loopLength)).values())
      moves.push({ ...move, beat });
  }
  return moves;
}
