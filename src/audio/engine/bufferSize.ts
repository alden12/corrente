/**
 * The output buffer's size, picked for you (INST-36.9). A phone's glitches are stalls, blocks the
 * audio thread renders late, and a bigger buffer absorbs them (on a phone, slow blocks at 32 voices
 * went from 44 to 0); but a bigger buffer is also a later note when you play one. So the buffer is
 * small while someone is playing live and large while they only listen, it grows on a device that
 * keeps rendering late, and it can be set by hand.
 *
 * A new size is a new AudioContext, a brief dropout, so it changes only when nothing would be cut:
 * the transport stopped, no take in progress, no note held, and quiet for a moment. The policy is
 * pure; `BufferControl` applies it to the engine.
 */

/** Web Audio's buffer hints, smallest (least latency) first. */
export const BUFFER_SIZES = ["interactive", "balanced", "playback"] as const;
export type BufferSize = (typeof BUFFER_SIZES)[number];

/** The setting: picked for you, or a size by hand. */
export type BufferSetting = "auto" | BufferSize;
export const BUFFER_SETTINGS: readonly BufferSetting[] = ["auto", ...BUFFER_SIZES];

/** How long after the last note played live it counts as playing live still. */
export const LIVE_FOR_MS = 2 * 60_000;
/** How long everything must have been quiet before the buffer changes, so no tail is cut. */
export const QUIET_FOR_MS = 1500;
/** Slow blocks within a minute of playing live that grow the live buffer a step on this device. */
export const SLOW_BLOCKS_TO_GROW = 4;
export const SLOW_WINDOW_MS = 60_000;

/** The size wanted: the setting's, or live's size while playing live and the largest otherwise. */
export const wantedSize = (setting: BufferSetting, live: boolean, liveStep: number): BufferSize => {
  if (setting !== "auto") return setting;
  return live ? BUFFER_SIZES[Math.min(liveStep, BUFFER_SIZES.length - 1)] : "playback";
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
