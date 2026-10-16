/**
 * Record a new take into one track (arms it first); stops if already recording. Audio
 * tracks capture the mic; instrument tracks capture live MIDI notes.
 *
 * Lives beside the clip list - the clip rail's footer on desktop, the Clips tab on
 * touch - because a take arrives as a new clip.
 */
import type { Recorder } from "../../audio/recording/recorder";

export function TrackRecordButton({
  trackId,
  recorder,
  recording,
  round = false,
}: {
  trackId: string;
  recorder: Recorder;
  recording: boolean;
  /** Just the record circle, for a section header's actions (the desktop clips, DAW-61.1). */
  round?: boolean;
}) {
  if (round)
    return (
      <button
        type="button"
        onClick={() => recorder.recordInto(trackId)}
        aria-label={recording ? "Stop recording" : "Record a new take into this track"}
        title={recording ? "Stop recording" : "Record a new take into this track"}
        className={`flex items-center justify-center w-7 h-7 rounded-full cursor-pointer ${
          recording ? "bg-hot/15" : "hover:bg-hot/10"
        }`}
      >
        <span
          className={`w-3 h-3 bg-hot ${recording ? "rounded-[2px] animate-pulse" : "rounded-full"}`}
          aria-hidden="true"
        />
      </button>
    );
  return (
    <button
      type="button"
      onClick={() => recorder.recordInto(trackId)}
      title={recording ? "Stop recording" : "Record a new take into this track"}
      // A pill, to match the clips it sits under: what it makes is another one of them.
      className={`w-full inline-flex items-center justify-center gap-1.5 font-mono text-[11px] px-2 py-1 rounded-full border cursor-pointer ${
        recording ? "text-hot bg-hot/15 border-hot/55" : "text-hot/85 border-hot/40 hover:bg-hot/10"
      }`}
    >
      <span className={`w-2.5 h-2.5 rounded-full bg-current ${recording ? "animate-pulse" : ""}`} />
      {recording ? "Stop" : "Rec"}
    </button>
  );
}
