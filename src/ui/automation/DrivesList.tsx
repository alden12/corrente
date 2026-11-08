/**
 * What an automation clip drives (DAW-67.5): each knob with its device and its range in the knob's
 * own units, to set, invert or let go of; and "+ Bind a knob", which lights the knobs in the devices
 * below to click (`bindMode`). The canvas's "Drives" list.
 */
import type { Track } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import type { AutomationBinding, AutomationClipData } from "../../audio/project/types";
import { knobStore } from "../../audio/automation/player";
import { bindMode, revealKnob, useBindMode } from "./bindMode";
import { knobLabel } from "./labels";

export function DrivesList({ track, clip, dispatch }: { track: Track; clip: AutomationClipData; dispatch: Dispatch }) {
  const picking = useBindMode();
  const binding = picking?.trackId === track.id && picking.automationId === clip.id;
  const write = (bindings: AutomationBinding[]) =>
    dispatch({ type: "setAutomation", trackId: track.id, automationId: clip.id, bindings });
  const change = (id: string, patch: Partial<AutomationBinding>) =>
    write(clip.bindings.map((each) => (each.id === id ? { ...each, ...patch } : each)));

  return (
    <div className="flex flex-col gap-2" data-testid="drives-list">
      <span className="font-mono text-[10px] tracking-[0.14em] text-faint">DRIVES</span>
      {clip.bindings.length === 0 && !binding && (
        <p className="text-[12px] text-muted">Nothing yet: bind a knob for this curve to move.</p>
      )}
      {clip.bindings.map((each) => {
        const label = knobLabel(track, each);
        const store = knobStore(track, each);
        const spec = store?.spec(each.param);
        const step = spec?.kind === "number" ? (spec.step ?? (spec.max - spec.min) / 1000) : undefined;
        return (
          <div
            key={each.id}
            data-testid="drives-row"
            className="rounded-lg border border-line bg-panel px-2.5 py-2 flex flex-col gap-1.5"
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                title="Show this knob"
                onClick={() => revealKnob(track.id, each)}
                className={`font-semibold text-[12.5px] cursor-pointer hover:underline ${label.missing ? "text-muted line-through" : "text-ink"}`}
              >
                {label.knob}
              </button>
              <span className="flex-1 min-w-0 truncate text-[11px] text-muted">{label.device}</span>
              <button
                type="button"
                title="Swap the range's ends"
                aria-label={`Invert ${label.knob}`}
                onClick={() => change(each.id, { min: each.max, max: each.min })}
                className="h-6 px-1.5 rounded text-[11px] text-muted hover:text-ink hover:bg-control cursor-pointer"
              >
                ⇅
              </button>
              <button
                type="button"
                aria-label={`Stop driving ${label.knob}`}
                title="Stop driving this knob"
                onClick={() => write(clip.bindings.filter((other) => other.id !== each.id))}
                className="h-6 w-6 rounded text-[14px] text-muted hover:text-hot hover:bg-control cursor-pointer"
              >
                ×
              </button>
            </div>
            {spec?.kind === "number" && (
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
                <input
                  type="number"
                  aria-label={`${label.knob} at the curve's bottom`}
                  value={each.min}
                  min={spec.min}
                  max={spec.max}
                  step={step}
                  onChange={(event) => change(each.id, { min: Number(event.target.value) })}
                  className="w-20 rounded bg-control px-1.5 py-0.5 text-ink"
                />
                <span>to</span>
                <input
                  type="number"
                  aria-label={`${label.knob} at the curve's top`}
                  value={each.max}
                  min={spec.min}
                  max={spec.max}
                  step={step}
                  onChange={(event) => change(each.id, { max: Number(event.target.value) })}
                  className="w-20 rounded bg-control px-1.5 py-0.5 text-ink"
                />
                {spec.unit && <span>{spec.unit}</span>}
              </div>
            )}
          </div>
        );
      })}
      {binding ? (
        <div className="rounded-lg border border-you bg-you/10 p-2.5 flex flex-col gap-2">
          <p className="text-[12px] text-ink">
            Click knobs in the devices below to drive them. Click a lit one again to let go.
          </p>
          <button
            type="button"
            onClick={() => bindMode.set(null)}
            className="self-start h-7 px-3 rounded-md bg-you text-ground text-[12px] font-semibold cursor-pointer"
          >
            Done
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => bindMode.set({ trackId: track.id, automationId: clip.id })}
          className="h-8 rounded-lg border border-dashed border-line text-[12px] text-muted hover:text-ink hover:border-you cursor-pointer"
        >
          + Bind a knob
        </button>
      )}
    </div>
  );
}
