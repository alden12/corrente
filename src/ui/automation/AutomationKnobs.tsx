/**
 * Automation on a track's knobs (DAW-67.5, 67.6), through the knobs' extras (`knobExtras.ts`), so
 * whatever a page already adds to its knobs carries on:
 *
 * - **Binding**: while an automation clip is picking its knobs (`bindMode`), each number knob on the
 *   track lights up, and a click binds it at its whole range, or unbinds one the clip drives.
 * - **Marks**: a knob some clip drives wears `AutomatedMark`: its frame and live value, or "Back to
 *   automation" once grabbed this play.
 * - **Its menu** (right-click): Automate (a new clip on the timeline, or one playing with the track's
 *   open note clip), Also drive from (a clip already there), Add an LFO (a clip of one repeating
 *   sine over the loop), Back to automation, Stop automating.
 */
import type { ReactNode } from "react";
import type { ProjectStore, Track } from "../../audio/project/projectStore";
import type { Scheduler } from "../../audio/sequencer/scheduler";
import type { Dispatch } from "../../audio/commands/types";
import type { ParamStore } from "../../audio/params/store";
import type { AutomationBinding, AutomationTarget } from "../../audio/project/types";
import { KnobExtrasProvider, useKnobExtras, type KnobExtras } from "../knobExtras";
import type { MenuItem } from "../Menu";
import {
  newAutomationBindingId,
  newAutomationId,
  newAutomationPointId,
  newPlacementId,
} from "../../audio/commands/ids";
import { automationSelection } from "./automationSelection";
import { sameTarget, targetOf, useBindMode } from "./bindMode";
import { AutomatedMark } from "./AutomatedMark";
import { useAutomationOverrides } from "./useAutomationOverrides";
import { clamp } from "../../util";

/** One cycle of a new LFO, in beats, and how far it swings either side. */
const LFO_RATE = 1;
const LFO_DEPTH = 0.25;

export function AutomationKnobs({
  track,
  projectStore,
  scheduler,
  dispatch,
  children,
}: {
  track: Track;
  projectStore: ProjectStore;
  scheduler: Scheduler;
  dispatch: Dispatch;
  children: ReactNode;
}) {
  const outer = useKnobExtras();
  const picking = useBindMode();
  const player = useAutomationOverrides(scheduler.automation);
  const picker =
    picking?.trackId === track.id
      ? track.automations.find((automation) => automation.id === picking.automationId)
      : undefined;

  /** The clips driving a knob, and the binding each does it by. */
  const drivers = (target: AutomationTarget, id: string) =>
    track.automations.flatMap((clip) =>
      clip.bindings
        .filter((binding) => binding.param === id && sameTarget(binding.target, target))
        .map((binding) => ({ clip, binding })),
    );

  /** A number knob on this track: its device, spec and value as the curve's 0..1. */
  const knobOf = (store: ParamStore, id: string) => {
    const target = targetOf(track, store);
    const spec = store.has(id) ? store.spec(id) : undefined;
    if (!target || spec?.kind !== "number") return undefined;
    const span = spec.max - spec.min;
    const value = span > 0 ? clamp((Number(store.get(id)) - spec.min) / span, 0, 1) : 0;
    return { target, spec, value };
  };

  const menu = (store: ParamStore, id: string): MenuItem[] | undefined => {
    const above = outer?.menu(store, id) ?? [];
    const knob = knobOf(store, id);
    if (!knob) return above.length ? above : undefined;
    const { target, spec, value } = knob;
    const binding = (): AutomationBinding => ({
      id: newAutomationBindingId(),
      target,
      param: id,
      min: spec.min,
      max: spec.max,
    });
    const driving = drivers(target, id);
    const overridden = driving.some(({ binding: each }) => player.isOverridden(track.id, each));
    const make = (extra: { linkedClipId?: string; name: string; lfo?: boolean }) => {
      const automationId = newAutomationId();
      const loopStart = projectStore.loopStart;
      dispatch({
        type: "addAutomation",
        trackId: track.id,
        id: automationId,
        name: extra.name,
        ...(extra.lfo ? { lengthBeats: 4 } : {}),
        points: extra.lfo
          ? [
              { id: newAutomationPointId(), beat: 0, value, shape: "sine", rate: LFO_RATE, depth: LFO_DEPTH },
              { id: newAutomationPointId(), beat: 4, value },
            ]
          : [{ id: newAutomationPointId(), beat: 0, value }],
        bindings: [binding()],
        ...(extra.linkedClipId
          ? { linkedClipId: extra.linkedClipId }
          : {
              placement: {
                id: newPlacementId(),
                startBeat: extra.lfo ? loopStart : (scheduler.getCursor() ?? 0),
                ...(extra.lfo ? { length: projectStore.length - loopStart } : {}),
              },
            }),
      });
      automationSelection.set({ trackId: track.id, automationId });
    };
    const openClip =
      track.kind === "instrument" ? track.clips.find((clip) => clip.id === track.activeClipId) : undefined;
    const others = track.automations.filter((clip) => !driving.some((driver) => driver.clip.id === clip.id));
    const items: MenuItem[] = [
      {
        label: "Automate",
        submenu: [
          { label: "New clip on the timeline", onClick: () => make({ name: spec.label }) },
          ...(openClip
            ? [
                {
                  label: `New clip playing with ${openClip.name}`,
                  onClick: () => make({ name: spec.label, linkedClipId: openClip.id }),
                },
              ]
            : []),
        ],
      },
      ...(others.length
        ? [
            {
              label: "Also drive from",
              submenu: others.map((clip) => ({
                label: clip.name,
                onClick: () =>
                  dispatch({
                    type: "setAutomation",
                    trackId: track.id,
                    automationId: clip.id,
                    bindings: [...clip.bindings, binding()],
                  }),
              })),
            },
          ]
        : []),
      { label: "Add an LFO", onClick: () => make({ name: `${spec.label} LFO`, lfo: true }) },
      ...(overridden
        ? [
            {
              label: "Back to automation",
              onClick: () => driving.forEach(({ binding: each }) => player.backToAutomation(track.id, each)),
            },
          ]
        : []),
      ...(driving.length
        ? [
            {
              label: "Stop automating",
              danger: true,
              onClick: () =>
                driving.forEach(({ clip, binding: each }) =>
                  dispatch({
                    type: "setAutomation",
                    trackId: track.id,
                    automationId: clip.id,
                    bindings: clip.bindings.filter((other) => other.id !== each.id),
                  }),
                ),
            },
          ]
        : []),
    ];
    return above.length ? [...above, { separator: true }, ...items] : items;
  };

  const overlay = (store: ParamStore, id: string) => {
    const below = outer?.overlay?.(store, id);
    const knob = knobOf(store, id);
    if (!knob) return below;
    const driving = drivers(knob.target, id);
    const mark = driving[0] && (
      <AutomatedMark
        track={track}
        binding={driving[0].binding}
        store={store}
        scheduler={scheduler}
        projectStore={projectStore}
        overridden={driving.some(({ binding }) => player.isOverridden(track.id, binding))}
        onBack={() => driving.forEach(({ binding }) => player.backToAutomation(track.id, binding))}
      />
    );
    if (!picker)
      return below || mark ? (
        <>
          {below}
          {mark}
        </>
      ) : undefined;
    const bound = picker.bindings.find((binding) => binding.param === id && sameTarget(binding.target, knob.target));
    const bindings = bound
      ? picker.bindings.filter((binding) => binding !== bound)
      : [
          ...picker.bindings,
          { id: newAutomationBindingId(), target: knob.target, param: id, min: knob.spec.min, max: knob.spec.max },
        ];
    return (
      <>
        {below}
        {mark}
        <button
          type="button"
          data-testid="bind-knob"
          data-bound={!!bound}
          aria-label={`${bound ? "Unbind" : "Bind"} ${knob.spec.label} ${bound ? "from" : "to"} ${picker.name}`}
          title={bound ? `Driven by ${picker.name}: click to unbind` : `Click to drive with ${picker.name}`}
          onClick={(event) => {
            event.stopPropagation();
            dispatch({ type: "setAutomation", trackId: track.id, automationId: picker.id, bindings });
          }}
          className={`absolute -inset-1 z-20 rounded-lg cursor-pointer ${
            bound
              ? "ring-2 ring-[var(--color-warn)] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)]"
              : "ring-2 ring-you shadow-[0_0_12px_var(--color-you)] bg-you/5 hover:bg-you/15"
          }`}
        />
      </>
    );
  };

  const extras: KnobExtras = { menu, badge: (store, id) => outer?.badge(store, id), overlay };
  return <KnobExtrasProvider value={extras}>{children}</KnobExtrasProvider>;
}
