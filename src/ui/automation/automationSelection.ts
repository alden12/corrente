/**
 * Which automation clip is chosen (DAW-67.4/5): picked on the timeline, shown and edited in the
 * workbench's automation section. App-wide view state, not part of the project, like a selected
 * note: one choice at a time, cleared when its clip goes.
 */
import { useSyncExternalStore } from "react";
import { createValueStore } from "../../listeners";
import { newAutomationPointId } from "../../audio/commands/ids";

export interface AutomationChoice {
  trackId: string;
  automationId: string;
  /** The placement picked on the timeline, if one was (a linked clip's runs have none). */
  placementId?: string;
}

export const automationSelection = createValueStore<AutomationChoice | null>(null);

export function useAutomationSelection(): AutomationChoice | null {
  return useSyncExternalStore(automationSelection.subscribe, automationSelection.read, automationSelection.read);
}

/** A new automation clip's curve from the app: flat at half way, so it has a line to grab. */
export const newAutomationPoints = () => [{ id: newAutomationPointId(), beat: 0, value: 0.5 }];
