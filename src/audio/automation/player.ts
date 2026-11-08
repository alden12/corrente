/**
 * Automation playing (DAW-67): the scheduler hands it each window it schedules, and it sends the
 * knobs' moves to the engine as timed param events, the path notes take, without editing the
 * project. A knob's own value, the one saved and shown at rest, stays as it was set.
 *
 * - **Sampled every `STEP_SECONDS`**, on a grid of the continuous count. Each move is a step the
 *   engine ramps over a block (or a param's `smoothMs`), so at 5 ms a sweep is a run of steps too
 *   small to hear, and a sixteenth-note sine at 120 bpm still gets 25 of them a cycle.
 * - **Grabbing an automated knob overrides it** until the next play, or until "Back to automation":
 *   any change to its store while it plays is someone moving it (automation never writes there),
 *   so the moves queued ahead for it are dropped and its own value goes back to the engine.
 * - **At a stop** every knob it moved goes back to its own value, and the overrides last until the
 *   next play starts.
 *
 * MIDI devices' params aren't played yet: they reach their devices another way than the engine's
 * params, and nothing automates one yet.
 */
import type { ProjectStore, Track } from "../project/projectStore";
import type { ParamStore } from "../params/store";
import type { AutomationBinding } from "../project/types";
import { createListeners } from "../../listeners";
import { automationMoves, automationRuns, bindingKnob } from "./playback";

/** How often a curve is sampled while it plays, in seconds of playback. */
export const STEP_SECONDS = 0.005;

/** What the player needs of the audio engine. */
export interface AutomationEngine {
  readonly currentTime: number;
  automate(trackId: string, store: ParamStore, id: string, value: number, time: number): void;
  releaseAutomation(trackId: string, store: ParamStore, id: string, time: number): void;
}

/** A window the scheduler is scheduling: continuous beats, and how to turn one into context time. */
export interface AutomationWindow {
  fromBeat: number;
  toBeat: number;
  loopStart: number;
  loopLength: number;
  beatsPerSecond: number;
  timeAt: (beat: number) => number;
}

interface Knob {
  trackId: string;
  store: ParamStore;
  id: string;
}

/** A knob on a track, by where its binding points: the track's instrument or one of its effects. */
export function knobStore(track: Track, binding: Pick<AutomationBinding, "target" | "param">): ParamStore | undefined {
  const { target } = binding;
  const store =
    target.kind === "instrument"
      ? track.kind === "instrument"
        ? track.params
        : undefined
      : target.kind === "effect"
        ? track.effects.find((effect) => effect.id === target.effectId)?.params
        : undefined;
  return store?.has(binding.param) && store.spec(binding.param).kind === "number" ? store : undefined;
}

/** A value kept in a number knob's range: a binding's range may say more than the knob takes. */
export function knobValue(store: ParamStore, id: string, value: number): number {
  const spec = store.spec(id);
  return spec.kind === "number" ? Math.min(spec.max, Math.max(spec.min, value)) : value;
}

/** A track's knob as one key: the track and `bindingKnob`. */
export const knobKey = (trackId: string, binding: Pick<AutomationBinding, "target" | "param">): string =>
  `${trackId}|${bindingKnob(binding)}`;

export class AutomationPlayer {
  /** Knobs moved this play, by `knobKey`, to put back at the stop. */
  private readonly moved = new Map<string, Knob>();
  /** Knobs grabbed this play, which automation leaves alone until the next. */
  private readonly overridden = new Set<string>();
  /** The stores of moved knobs, listened to for a grab. */
  private readonly watched = new Map<ParamStore, () => void>();
  private readonly listeners = createListeners();
  private readonly engine: AutomationEngine;
  private readonly project: ProjectStore;

  constructor(engine: AutomationEngine, project: ProjectStore) {
    this.engine = engine;
    this.project = project;
  }

  /** Hear a knob overridden or handed back. */
  readonly subscribe = this.listeners.subscribe;

  /** A new play: every knob follows its automation again. */
  begin(): void {
    if (this.overridden.size === 0) return;
    this.overridden.clear();
    this.listeners.emit();
  }

  /** Send the moves across a window, for every track but the ones `skip` names (muted, silenced). */
  schedule(window: AutomationWindow, skip: (track: Track) => boolean): void {
    const now = this.engine.currentTime;
    const stepBeats = STEP_SECONDS * window.beatsPerSecond;
    for (const track of this.project.getTracks()) {
      if (track.automations.length === 0 || skip(track)) continue;
      const runs = automationRuns(track, window.loopStart, window.loopLength);
      const moves = automationMoves(
        runs,
        window.fromBeat,
        window.toBeat,
        window.loopStart,
        window.loopLength,
        stepBeats,
      );
      for (const move of moves) {
        const key = knobKey(track.id, move.binding);
        const store = knobStore(track, move.binding);
        if (!store || this.overridden.has(key)) continue;
        const id = move.binding.param;
        this.remember(key, { trackId: track.id, store, id });
        const value = knobValue(store, id, move.value);
        this.engine.automate(track.id, store, id, value, Math.max(now, window.timeAt(move.beat)));
      }
    }
  }

  /** The transport stopped: every knob automation moved goes back to its own value. */
  end(): void {
    const now = this.engine.currentTime;
    this.moved.forEach((knob, key) => {
      if (!this.overridden.has(key)) this.engine.releaseAutomation(knob.trackId, knob.store, knob.id, now);
    });
    this.moved.clear();
    this.watched.forEach((unsubscribe) => unsubscribe());
    this.watched.clear();
  }

  /** Whether a knob was grabbed this play, so its automation rests until the next. */
  isOverridden(trackId: string, binding: Pick<AutomationBinding, "target" | "param">): boolean {
    return this.overridden.has(knobKey(trackId, binding));
  }

  /** How many knobs are overridden: what "Back to automation" would hand back. */
  get overriddenCount(): number {
    return this.overridden.size;
  }

  /** Hand knobs back to their automation: one track's knob, or every knob overridden. */
  backToAutomation(trackId?: string, binding?: Pick<AutomationBinding, "target" | "param">): void {
    const keys =
      trackId && binding
        ? [knobKey(trackId, binding)]
        : [...this.overridden].filter((key) => !trackId || key.startsWith(`${trackId}|`));
    const changed = keys.filter((key) => this.overridden.delete(key));
    if (changed.length > 0) this.listeners.emit();
  }

  private remember(key: string, knob: Knob): void {
    if (!this.moved.has(key)) this.moved.set(key, knob);
    if (!this.watched.has(knob.store))
      this.watched.set(
        knob.store,
        knob.store.subscribe((id) => this.grabbed(knob.store, id)),
      );
  }

  /** Someone moved a knob automation is playing: it's theirs until the next play. */
  private grabbed(store: ParamStore, id: string): void {
    let changed = false;
    this.moved.forEach((knob, key) => {
      if (knob.store !== store || knob.id !== id || this.overridden.has(key)) return;
      this.overridden.add(key);
      this.engine.releaseAutomation(knob.trackId, store, id, this.engine.currentTime);
      changed = true;
    });
    if (changed) this.listeners.emit();
  }
}
