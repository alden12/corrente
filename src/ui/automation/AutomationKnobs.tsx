/**
 * Automation on a track's knobs (DAW-67.5), through the knobs' extras (`knobExtras.ts`): while an
 * automation clip is picking its knobs (`bindMode`), each number knob on the track lights up, and a
 * click binds it to the clip at its whole range, or unbinds one the clip already drives. Whatever a
 * page already adds to its knobs carries on.
 */
import type { ReactNode } from "react";
import type { Track } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import { KnobExtrasProvider, useKnobExtras, type KnobExtras } from "../knobExtras";
import { newAutomationBindingId } from "../../audio/commands/ids";
import { sameTarget, targetOf, useBindMode } from "./bindMode";

export function AutomationKnobs({
  track,
  dispatch,
  children,
}: {
  track: Track;
  dispatch: Dispatch;
  children: ReactNode;
}) {
  const outer = useKnobExtras();
  const picking = useBindMode();
  const clip =
    picking?.trackId === track.id
      ? track.automations.find((automation) => automation.id === picking.automationId)
      : undefined;
  const extras: KnobExtras = {
    menu: (store, id) => outer?.menu(store, id),
    badge: (store, id) => outer?.badge(store, id),
    overlay: (store, id) => {
      const below = outer?.overlay?.(store, id);
      const target = clip && targetOf(track, store);
      const spec = store.has(id) ? store.spec(id) : undefined;
      if (!clip || !target || spec?.kind !== "number") return below;
      const bound = clip.bindings.find((binding) => binding.param === id && sameTarget(binding.target, target));
      const bindings = bound
        ? clip.bindings.filter((binding) => binding !== bound)
        : [...clip.bindings, { id: newAutomationBindingId(), target, param: id, min: spec.min, max: spec.max }];
      return (
        <>
          {below}
          <button
            type="button"
            data-testid="bind-knob"
            data-bound={!!bound}
            aria-label={`${bound ? "Unbind" : "Bind"} ${spec.label} ${bound ? "from" : "to"} ${clip.name}`}
            title={bound ? `Driven by ${clip.name}: click to unbind` : `Click to drive with ${clip.name}`}
            onClick={(event) => {
              event.stopPropagation();
              dispatch({ type: "setAutomation", trackId: track.id, automationId: clip.id, bindings });
            }}
            className={`absolute -inset-1 z-10 rounded-lg cursor-pointer ${
              bound
                ? "ring-2 ring-[var(--color-warn)] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)]"
                : "ring-2 ring-you shadow-[0_0_12px_var(--color-you)] bg-you/5 hover:bg-you/15"
            }`}
          />
        </>
      );
    },
  };
  return <KnobExtrasProvider value={extras}>{children}</KnobExtrasProvider>;
}
