/** The transport's cursor (DAW-31), as an arrangement beat or null, re-rendering when it moves. */
import { useSyncExternalStore } from "react";
import type { Scheduler } from "../audio/sequencer/scheduler";

export const useCursor = (scheduler: Scheduler): number | null =>
  useSyncExternalStore(
    (listener) => scheduler.subscribeCursor(listener),
    () => scheduler.getCursor(),
  );
