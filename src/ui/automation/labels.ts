/**
 * What an automation clip's knobs are called on screen (DAW-67): each binding's knob label and the
 * device it's on, read from the track's catalogs and schemas, never a list of names here.
 */
import type { Track } from "../../audio/project/projectStore";
import type { AutomationBinding } from "../../audio/project/types";
import { catalogEntry, hasInstrument } from "../../audio/instruments/catalog";
import { effectCatalogEntry, hasEffect } from "../../audio/effects/catalog";
import { knobStore } from "../../audio/automation/player";
import { formatNumber } from "../paramFormat";

export interface KnobLabel {
  /** The knob's own label ("Cutoff"), or its param id if the knob has gone. */
  knob: string;
  /** The device it's on ("Bass synth", "Delay"), or "missing" if that has gone. */
  device: string;
  /** The binding's range in the knob's units ("400 Hz to 4.0 kHz"), where the knob is there to say. */
  range?: string;
  missing: boolean;
}

export function knobLabel(track: Track, binding: AutomationBinding): KnobLabel {
  const store = knobStore(track, binding);
  const { target } = binding;
  const device =
    target.kind === "instrument"
      ? track.kind === "instrument" && hasInstrument(track.instrumentType)
        ? catalogEntry(track.instrumentType).label
        : "Instrument"
      : target.kind === "effect"
        ? (() => {
            const effect = track.effects.find((candidate) => candidate.id === target.effectId);
            return effect && hasEffect(effect.type) ? effectCatalogEntry(effect.type).label : "missing";
          })()
        : "MIDI device";
  if (!store) return { knob: binding.param, device, missing: true };
  const spec = store.spec(binding.param);
  const range =
    spec.kind === "number" ? `${formatNumber(spec, binding.min)} to ${formatNumber(spec, binding.max)}` : undefined;
  return { knob: spec.label, device, ...(range ? { range } : {}), missing: false };
}
