/**
 * The mix as a WAV file (DAW-13): the loop region, rendered on the engine render core in the render
 * worker (the same sound the transport plays, without freezing the page), as 24-bit stereo at 48 kHz.
 *
 * Only the loop region, and no tail added (2026-11-01, Alden): the region says what to export, so
 * a song ending on a long reverb is exported with the region drawn past its last bar. Whole-song
 * and stem options can come later.
 */
import type { ProjectStore } from "../audio/project/projectStore";
import { fileStem } from "../audio/projects/projectVersions";
import { encodeWavChannels } from "../audio/recording/wav";
import { renderProjectInWorker } from "../audio/engine/renderInWorker";
import { download } from "./projectFile";

const MIXDOWN_RATE = 48000;

/** `night-drive-mix.wav`. */
export const mixdownFileName = (name: string): string => `${fileStem(name)}-mix.wav`;

/** What a mixdown left out, and whether it clipped, for the page to say. */
export interface MixdownReport {
  omitted: string[];
  clipped: boolean;
}

export async function exportMixdown(projectStore: ProjectStore, name: string): Promise<MixdownReport> {
  const render = await renderProjectInWorker(projectStore, { sampleRate: MIXDOWN_RATE, tailSec: 0 });
  const wav = encodeWavChannels(render.channels, render.sampleRate, 24);
  download(new Blob([wav], { type: "audio/wav" }), mixdownFileName(name));
  return { omitted: render.omitted, clipped: render.masterOver > 0 };
}
