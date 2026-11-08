/**
 * An automation clip picking its knobs (DAW-67.5): while set, the knobs on its track light up, and a
 * click binds one to it, or unbinds one it drives. View state, one clip at a time.
 */
import { useSyncExternalStore } from "react";
import { createValueStore } from "../../listeners";
import type { ParamStore } from "../../audio/params/store";
import type { Track } from "../../audio/project/projectStore";
import type { AutomationTarget } from "../../audio/project/types";

export const bindMode = createValueStore<{ trackId: string; automationId: string } | null>(null);

export const useBindMode = () => useSyncExternalStore(bindMode.subscribe, bindMode.read, bindMode.read);

/** Which of a track's devices a knob's store is: its instrument or one of its effects. */
export function targetOf(track: Track, store: ParamStore): AutomationTarget | undefined {
  if (track.kind === "instrument" && track.params === store) return { kind: "instrument" };
  const effect = track.effects.find((candidate) => candidate.params === store);
  return effect && { kind: "effect", effectId: effect.id };
}

/** Whether a binding names this device. */
export const sameTarget = (left: AutomationTarget, right: AutomationTarget): boolean =>
  left.kind === right.kind &&
  (left.kind !== "effect" || (right.kind === "effect" && left.effectId === right.effectId)) &&
  (left.kind !== "midiDevice" || (right.kind === "midiDevice" && left.deviceId === right.deviceId));
