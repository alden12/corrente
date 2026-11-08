/**
 * What an automated knob wears (DAW-67.6), laid over it by `AutomationKnobs`: an amber frame, and a
 * tag at its corner. The canvas's "Knob states" board, for every kind of control a knob can be (a
 * rotary knob, a fader, a row), which is why it frames the control rather than drawing on its ring.
 *
 * - **Automated**: the frame, and the tag, which while the transport plays reads the value the
 *   curve gives the knob there, a frame at a time off the audio clock (no React state per frame).
 * - **Grabbed** (overridden until the next play): the frame fades, and the tag becomes "Back to
 *   automation", which hands the knob back now.
 *
 * `data-automation-knob` names it, so the Drives list can scroll to it and flash it.
 */
import { useRef } from "react";
import type { ProjectStore, Track } from "../../audio/project/projectStore";
import type { Scheduler } from "../../audio/sequencer/scheduler";
import type { ParamStore } from "../../audio/params/store";
import type { AutomationBinding } from "../../audio/project/types";
import { automationRuns, bindingKnob, knobValuesAt } from "../../audio/automation/playback";
import { knobValue } from "../../audio/automation/player";
import { useAnimationFrame } from "../useAnimationFrame";
import { knobMarkKey } from "./bindMode";
import { formatNumber } from "../paramFormat";

export function AutomatedMark({
  track,
  binding,
  store,
  scheduler,
  projectStore,
  overridden,
  onBack,
}: {
  track: Track;
  /** One of the bindings driving this knob, to name it. */
  binding: AutomationBinding;
  store: ParamStore;
  scheduler: Scheduler;
  projectStore: ProjectStore;
  overridden: boolean;
  onBack: () => void;
}) {
  const readout = useRef<HTMLSpanElement>(null);
  const spec = store.spec(binding.param);

  useAnimationFrame(() => {
    const element = readout.current;
    if (!element) return;
    if (!scheduler.isPlaying || overridden || spec.kind !== "number") {
      element.textContent = "";
      return;
    }
    const loopStart = projectStore.loopStart;
    const runs = automationRuns(track, loopStart, projectStore.length - loopStart);
    const move = knobValuesAt(runs, scheduler.getPositionBeats()).get(bindingKnob(binding));
    element.textContent = move ? formatNumber(spec, knobValue(store, binding.param, move.value)) : "";
  }, [track, binding, store, scheduler, projectStore, overridden]);

  return (
    <>
      <span
        aria-hidden="true"
        data-automation-knob={knobMarkKey(track.id, binding)}
        className={`absolute -inset-1 rounded-lg pointer-events-none ring-1 ${
          overridden ? "ring-[color-mix(in_oklab,var(--color-warn)_35%,transparent)]" : "ring-[var(--color-warn)]"
        }`}
      />
      {overridden ? (
        <button
          type="button"
          data-testid="back-to-automation"
          aria-label={`Back to automation for ${spec.label}`}
          title="Back to automation"
          onClick={(event) => {
            event.stopPropagation();
            onBack();
          }}
          className="absolute -top-2 -right-2 z-10 h-5 px-1.5 rounded-full border border-[var(--color-warn)] bg-panel text-[10px] leading-none text-[var(--color-warn)] cursor-pointer"
        >
          ↺
        </button>
      ) : (
        <span
          data-testid="automated-mark"
          title={`Automated: ${spec.label} follows its curve while the song plays`}
          className="absolute -top-2 -right-2 z-10 h-4 min-w-4 px-1 flex items-center gap-1 rounded-full bg-[var(--color-warn)] text-[9px] leading-none text-ground font-mono pointer-events-none"
        >
          <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 8 C3 8 5 2 9 2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span ref={readout} data-testid="automated-value" />
        </span>
      )}
    </>
  );
}
