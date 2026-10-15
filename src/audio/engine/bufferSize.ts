/**
 * The output buffer's size, picked for you (INST-36.9, INST-43). A phone's glitches are stalls,
 * blocks the audio thread renders late, and a bigger buffer absorbs them (on a phone, slow blocks at
 * 32 voices went from 44 to 0); but a bigger buffer is also a later note when you play one.
 *
 * So the buffer is the smallest while the timeline is stopped, when anything you hear you're
 * playing, and stays that size for playback too until this device shows it can't keep up: slow
 * blocks while stopped grow the live size, slow blocks during playback grow the playback size, each
 * kept per device. A device that copes never changes size; one that struggles plays back larger,
 * switching as Play is pressed. It can also be set by hand.
 *
 * A new size is a new AudioContext, a brief dropout, so going back to the live size waits for a
 * moment nothing would be cut: the transport stopped, no take in progress, no note held, and quiet
 * for a moment. The policy is pure; `BufferControl` applies it to the engine.
 */

/** Web Audio's buffer hints, smallest (least latency) first. */
export const BUFFER_SIZES = ["interactive", "balanced", "playback"] as const;
export type BufferSize = (typeof BUFFER_SIZES)[number];

/** The setting: picked for you, or a size by hand. */
export type BufferSetting = "auto" | BufferSize;
export const BUFFER_SETTINGS: readonly BufferSetting[] = ["auto", ...BUFFER_SIZES];

/** How long everything must have been quiet before the buffer shrinks back, so no tail is cut. */
export const QUIET_FOR_MS = 1500;
/** Slow blocks within a minute, at a size, that grow it a step on this device. */
export const SLOW_BLOCKS_TO_GROW = 4;
export const SLOW_WINDOW_MS = 60_000;

/** How far each size has grown on this device: steps up BUFFER_SIZES from the smallest. */
export interface Steps {
  live: number;
  playback: number;
}

const sizeAt = (step: number): BufferSize => BUFFER_SIZES[Math.min(Math.max(step, 0), BUFFER_SIZES.length - 1)];

/** The live size, and the playback size, which is never smaller. */
export const liveSize = (steps: Steps): BufferSize => sizeAt(steps.live);
export const playbackSize = (steps: Steps): BufferSize => sizeAt(Math.max(steps.live, steps.playback));

/** The size wanted: the setting's, or the playback size while playing and the live size otherwise. */
export const wantedSize = (setting: BufferSetting, playing: boolean, steps: Steps): BufferSize => {
  if (setting !== "auto") return setting;
  return playing ? playbackSize(steps) : liveSize(steps);
};

/** What says whether now is a moment the buffer can change in. */
export interface Activity {
  playing: boolean;
  /** A take counting in or recording. */
  recording: boolean;
  /** A note held down live. */
  holding: boolean;
  /** Milliseconds since anything last sounded on purpose: a note played, the transport stopped. */
  quietFor: number;
}

export const canChange = ({ playing, recording, holding, quietFor }: Activity): boolean =>
  !playing && !recording && !holding && quietFor >= QUIET_FOR_MS;
