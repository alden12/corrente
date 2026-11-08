/**
 * Which knobs are grabbed off their automation this play (DAW-67.6), for what shows it: the knob's
 * mark, and the transport's "Back to automation". Re-renders only when that changes.
 */
import { useSyncExternalStore } from "react";
import type { AutomationPlayer } from "../../audio/automation/player";

export function useAutomationOverrides(player: AutomationPlayer): AutomationPlayer {
  useSyncExternalStore(
    player.subscribe,
    () => player.overriddenKeys,
    () => player.overriddenKeys,
  );
  return player;
}
