/**
 * Knob moves recorded as automation (DAW-67.7). While the recorder takes a pass, every move of a
 * number knob on the track it records into (its instrument's or an effect's) is noted against the
 * transport; when the take ends, each knob moved becomes an automation clip of its own, bound to it
 * and placed where the take started, with the curve it was moved through.
 *
 * - **From the take's start**: the curve opens at the knob's value as the take began, so the clip
 *   plays back the whole take, not just from the first touch, and closes at its value as it ended.
 * - **Thinned**: a hand on a knob sends a value every frame; points a straight line through their
 *   neighbours would draw anyway (within `THIN`) are dropped.
 * - **Overriding while held**: moving a knob while the song plays grabs it off any automation it
 *   already has (the player sees to that), so what is recorded is the hand, not the old curve.
 *
 * Apart from the recorder, which it only listens to: the recorder's own takes (notes, audio) are its
 * business, and this adds the knobs beside them.
 */
import type { ProjectStore, Track } from "../project/projectStore";
import type { Recorder } from "../recording/recorder";
import type { Dispatch } from "../commands/types";
import type { ParamStore } from "../params/store";
import type { AutomationPoint, AutomationTarget } from "../project/types";
import { newAutomationBindingId, newAutomationId, newAutomationPointId, newPlacementId } from "../commands/ids";
import { clamp } from "../../util";
import { bindingKnob } from "./playback";
import { MIN_AUTOMATION_BEATS } from "./edits";

/** How far off the straight line through its neighbours a point may be and still be dropped, 0..1. */
export const THIN = 0.004;

/** What a take needs of the transport. */
export interface TakeClock {
  readonly currentTime: number;
  continuousBeatAtTime(time: number): number;
  beatAtTime(time: number): number;
}

interface KnobMove {
  /** Beats into the take. */
  beat: number;
  value: number;
}

interface TakenKnob {
  target: AutomationTarget;
  store: ParamStore;
  param: string;
  /** The knob's value, 0..1, as the take began. */
  from: number;
  moves: KnobMove[];
}

/** Drop the points a straight line through their neighbours would draw anyway. */
export function thin(points: readonly KnobMove[], tolerance = THIN): KnobMove[] {
  if (points.length <= 2) return [...points];
  const kept: KnobMove[] = [points[0]];
  for (let index = 1; index < points.length - 1; index++) {
    const before = kept[kept.length - 1];
    const after = points[index + 1];
    const point = points[index];
    const span = after.beat - before.beat;
    const line =
      span > 0 ? before.value + ((after.value - before.value) * (point.beat - before.beat)) / span : before.value;
    if (Math.abs(point.value - line) > tolerance) kept.push(point);
  }
  kept.push(points[points.length - 1]);
  return kept;
}

/** A track's knob stores, by the device each is on. */
const knobStores = (track: Track): { target: AutomationTarget; store: ParamStore }[] => [
  ...(track.kind === "instrument" ? [{ target: { kind: "instrument" } as const, store: track.params }] : []),
  ...track.effects.map((effect) => ({
    target: { kind: "effect", effectId: effect.id } as const,
    store: effect.params,
  })),
];

export class KnobTake {
  private readonly recorder: Recorder;
  private readonly clock: TakeClock;
  private readonly project: ProjectStore;
  private readonly dispatch: Dispatch;
  private take: { trackId: string; startCount: number; startBeat: number; knobs: Map<string, TakenKnob> } | null = null;
  private unwatch: (() => void)[] = [];

  constructor(recorder: Recorder, clock: TakeClock, project: ProjectStore, dispatch: Dispatch) {
    this.recorder = recorder;
    this.clock = clock;
    this.project = project;
    this.dispatch = dispatch;
  }

  /** Follow the recorder: a pass starting starts a take, and one ending lands it. Returns the stop. */
  start(): () => void {
    const stop = this.recorder.subscribe(() => {
      const recording = this.recorder.getState().status === "recording";
      if (recording && !this.take) this.begin();
      else if (!recording && this.take) this.finish();
    });
    return () => {
      stop();
      this.unwatch.forEach((unwatch) => unwatch());
      this.unwatch = [];
      this.take = null;
    };
  }

  private begin(): void {
    const trackId = this.recorder.getState().armedTrackId ?? this.project.selectedId;
    const track = trackId ? this.project.getTrack(trackId) : undefined;
    if (!track) return;
    const now = this.clock.currentTime;
    const take = {
      trackId: track.id,
      startCount: this.clock.continuousBeatAtTime(now),
      startBeat: this.clock.beatAtTime(now),
      knobs: new Map<string, TakenKnob>(),
    };
    this.take = take;
    const values = new Map(knobStores(track).map(({ store }) => [store, store.snapshot()]));
    this.unwatch = knobStores(track).map(({ target, store }) =>
      store.subscribe((param, value) => {
        const spec = store.has(param) ? store.spec(param) : undefined;
        if (spec?.kind !== "number" || typeof value !== "number") return;
        const normal = (raw: number) =>
          spec.max > spec.min ? clamp((raw - spec.min) / (spec.max - spec.min), 0, 1) : 0;
        const key = bindingKnob({ target, param });
        const knob = take.knobs.get(key) ?? {
          target,
          store,
          param,
          from: normal(Number(values.get(store)?.[param] ?? spec.default)),
          moves: [],
        };
        take.knobs.set(key, knob);
        knob.moves.push({
          beat: this.clock.continuousBeatAtTime(this.clock.currentTime) - take.startCount,
          value: normal(value),
        });
      }),
    );
  }

  private finish(): void {
    const take = this.take;
    this.unwatch.forEach((unwatch) => unwatch());
    this.unwatch = [];
    this.take = null;
    if (!take || take.knobs.size === 0) return;
    const end = Math.max(
      MIN_AUTOMATION_BEATS,
      this.clock.continuousBeatAtTime(this.clock.currentTime) - take.startCount,
      ...[...take.knobs.values()].flatMap((knob) => knob.moves.map((move) => move.beat)),
    );
    for (const knob of take.knobs.values()) {
      const spec = knob.store.spec(knob.param);
      if (spec.kind !== "number") continue;
      const last = knob.moves[knob.moves.length - 1]?.value ?? knob.from;
      const curve = thin([{ beat: 0, value: knob.from }, ...knob.moves, { beat: end, value: last }]);
      const points: AutomationPoint[] = curve.map((move) => ({
        id: newAutomationPointId(),
        beat: move.beat,
        value: move.value,
      }));
      this.dispatch({
        type: "addAutomation",
        trackId: take.trackId,
        id: newAutomationId(),
        name: `${spec.label} take`,
        lengthBeats: end,
        points,
        bindings: [
          { id: newAutomationBindingId(), target: knob.target, param: knob.param, min: spec.min, max: spec.max },
        ],
        placement: { id: newPlacementId(), startBeat: take.startBeat, length: end },
      });
    }
  }
}
