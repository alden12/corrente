/**
 * An automation clip picking its knobs (DAW-67.5): while set, the knobs on its track light up, and a
 * click binds one to it, or unbinds one it drives. View state, one clip at a time.
 */
import { useSyncExternalStore } from "react";
import { createValueStore } from "../../listeners";
import type { ParamStore } from "../../audio/params/store";
import type { Track } from "../../audio/project/projectStore";
import type { AutomationBinding, AutomationTarget } from "../../audio/project/types";
import { bindingKnob } from "../../audio/automation/playback";

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

/** The attribute naming an automated knob on screen (DAW-67.6): its track and `bindingKnob`. */
export const knobMarkKey = (trackId: string, binding: Pick<AutomationBinding, "target" | "param">) =>
  `${trackId}|${bindingKnob(binding)}`;

/** Scroll to a track's knob on screen and flash it: where a Drives row points. */
export function revealKnob(trackId: string, binding: Pick<AutomationBinding, "target" | "param">): boolean {
  const mark = document.querySelector<HTMLElement>(
    `[data-automation-knob="${CSS.escape(knobMarkKey(trackId, binding))}"]`,
  );
  if (!mark) return false;
  mark.scrollIntoView({ block: "center", behavior: "smooth" });
  mark.animate([{ boxShadow: "0 0 0 6px var(--color-warn)" }, { boxShadow: "0 0 0 0 transparent" }], {
    duration: 900,
    easing: "ease-out",
  });
  return true;
}
