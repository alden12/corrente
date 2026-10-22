/** The transport's switches as per-device preferences (DAW-78), shared by every control that shows them. */
import { usePersistentBoolean } from "./usePersistent";

/** Whether play comes round the loop (default on). */
export const useLooping = () => usePersistentBoolean("corrente:loop", true);
/** Whether the metronome clicks during play (default off). */
export const useMetronome = () => usePersistentBoolean("corrente:metronome", false);
