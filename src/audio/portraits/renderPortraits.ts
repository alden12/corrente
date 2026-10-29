/**
 * Render every built-in's portrait (COMM-1.9.2): each instrument, factory patch, effect and MIDI
 * device, alone, drawn by `draw.ts`. Iterates the catalogs, so a newly registered device gets one
 * on the next `yarn portraits` (which runs this in Node and commits the result - nothing renders on
 * page load).
 *
 * Each is drawn by `drawPortrait`, on the engine render core (AGENT-4.9), so this runs wherever
 * the core does, given a setup for where it is. The user's own devices draw the same way, in the
 * browser, as their cards come into view (COMM-1.9.6).
 */
import { pickableInstrumentInfos } from "../instruments/catalog";
import { effectInfos } from "../effects/catalog";
import { midiDeviceInfos } from "../midi/device/catalog";
import { FACTORY_PATCHES } from "../patches/factory";
import type { RenderSetup } from "../render/renderDevice";
import type { Portrait } from "./draw";
import { drawPortrait, midiPortrait } from "./devicePortrait";
import { PORTRAIT_KEYS } from "./keys";

export async function renderPortraits(setup: RenderSetup): Promise<Record<string, Portrait>> {
  const jobs: (readonly [string, () => Promise<Portrait> | Portrait])[] = [
    ...pickableInstrumentInfos().map(
      (info) =>
        [
          PORTRAIT_KEYS.instrument(info.type),
          () => drawPortrait({ kind: "instrument", type: info.type }, setup),
        ] as const,
    ),
    ...FACTORY_PATCHES.map(
      (patch) => [PORTRAIT_KEYS.patch(patch.id), () => drawPortrait({ kind: "patch", sound: patch }, setup)] as const,
    ),
    ...effectInfos().map(
      (info) =>
        [PORTRAIT_KEYS.effect(info.type), () => drawPortrait({ kind: "effect", type: info.type }, setup)] as const,
    ),
    ...midiDeviceInfos().map((info) => [PORTRAIT_KEYS.midi(info.type), () => midiPortrait(info.type, setup)] as const),
  ];
  // One at a time, so the order keeps the output file stable from run to run.
  const portraits: Record<string, Portrait> = {};
  for (const [key, draw] of jobs) portraits[key] = await draw();
  return portraits;
}
