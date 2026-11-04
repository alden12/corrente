/**
 * The pad or key last played, by its notes (`padKey`): what the next-chord hints light from
 * (DAW-12.2). Shared, so a chord struck on the computer keyboard lights the pads the same as a tap.
 * It outlives the press: the hints are there to choose the next chord once you've let go.
 */
import { useSyncExternalStore } from "react";
import { createValueStore } from "../../listeners";

const lastPlayed = createValueStore<string | null>(null);

/** Record a pad or key played, by its `padKey`. */
export const playedPad = (key: string) => lastPlayed.set(key);

export const useLastPlayed = () => useSyncExternalStore(lastPlayed.subscribe, lastPlayed.read);
