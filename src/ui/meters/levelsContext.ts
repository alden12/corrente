/**
 * Where the meters read their levels from (DAW-8.5): the running engine, provided once by AppShell
 * so a fader deep in the arrangement needn't be handed the engine. Absent (a test, a static
 * surface), faders draw no meter.
 */
import { createContext, useContext } from "react";

export interface LevelSource {
  /** A track's or group's loudest sample of each channel just now, as gains. */
  levels(id: string): [number, number];
  /** The master's, left and right. */
  masterLevels(): [number, number];
}

const LevelsContext = createContext<LevelSource | null>(null);

export const LevelsProvider = LevelsContext.Provider;

export const useLevelSource = (): LevelSource | null => useContext(LevelsContext);
