/**
 * An audio track's clips for the engine render core (AGENT-4.9 part 2c): every trigger laid onto one
 * stereo tape the length of the render, which the track's effects then hear block by block. It plays
 * what the live engine plays (AudioEngine.scheduleAudioClip): the slice of each file under its clip's
 * loop window (audioPlayWindow), at the clip's gain.
 */
import { audioPlayWindow } from "../engine/audioWindow";
import type { AudioTrack } from "../project/projectStore";
import { audioTriggers, type Timeline } from "./trackNotes";
import type { LoadAudio } from "./sampleAudio";

/** `channel` at `toRate`, by linear interpolation (the browser's decoder resamples to the context's rate the same way). */
export const resampled = (channel: Float32Array, fromRate: number, toRate: number): Float32Array => {
  if (fromRate === toRate) return channel;
  const ratio = fromRate / toRate;
  return Float32Array.from({ length: Math.floor((channel.length * toRate) / fromRate) }, (_, index) => {
    const at = index * ratio;
    const before = Math.floor(at);
    const after = Math.min(before + 1, channel.length - 1);
    return channel[before] + (channel[after] - channel[before]) * (at - before);
  });
};

/**
 * The tape of `frames` samples a track's clips make, and the files that wouldn't load. Each file is
 * loaded once, made stereo (a mono file plays in both channels) and brought to the render's rate.
 */
export async function audioTape(
  track: AudioTrack,
  timeline: Timeline,
  frames: number,
  sampleRate: number,
  load: LoadAudio,
): Promise<{ tape: [Float32Array, Float32Array]; missing: string[] }> {
  const triggers = audioTriggers(track, timeline);
  const fileIds = [...new Set(triggers.map(({ clip }) => clip.fileId))];
  const files = new Map(
    await Promise.all(
      fileIds.map(async (fileId) => {
        const audio = await load(fileId);
        const stereo = audio && [audio.channels[0], audio.channels[1] ?? audio.channels[0]];
        return [fileId, stereo?.map((channel) => resampled(channel, audio!.rate, sampleRate))] as const;
      }),
    ),
  );
  const tape: [Float32Array, Float32Array] = [new Float32Array(frames), new Float32Array(frames)];
  triggers.forEach(({ clip, start, maxSec }) => {
    const file = files.get(clip.fileId);
    if (!file) return;
    const window = audioPlayWindow(
      clip.loopStartSec,
      clip.loopEndSec,
      clip.gridOffsetSec,
      file[0].length / sampleRate,
      maxSec,
    );
    if (!window) return;
    const from = Math.round(window.offset * sampleRate);
    const at = Math.round((start + window.delaySec) * sampleRate);
    const count = Math.min(Math.round(window.span * sampleRate), file[0].length - from, frames - at);
    tape.forEach((channel, index) => {
      for (let frame = 0; frame < count; frame++) channel[at + frame] += file[index][from + frame] * clip.gain;
    });
  });
  return { tape, missing: fileIds.filter((fileId) => !files.get(fileId)) };
}
