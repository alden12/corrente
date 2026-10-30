/**
 * What a lane shows while a clip is launched over it (DAW-79): the lane greys, and a button on it says
 * what's playing and what it goes back to, which pressing does. It replaced a "Clip mode · Back to
 * timeline" button in the arrangement's header, which stopped every launched clip at once and didn't
 * say which.
 */
import type { Track } from "../../audio/project/projectStore";
import type { Dispatch } from "../../audio/commands/types";
import { paletteAccent } from "../deviceColor";

/**
 * The clip the lane's timeline plays, if it's one clip throughout and not the launched one;
 * otherwise "the timeline".
 */
function timelineName(track: Track): string {
  const clipIds = new Set(track.placements.map((placement) => placement.clipId));
  const [only] = clipIds;
  const clip =
    clipIds.size === 1 && only !== track.launchedClipId
      ? track.clips.find((candidate) => candidate.id === only)
      : undefined;
  return clip?.name ?? "the timeline";
}

export function LaunchedClip({ track, dispatch }: { track: Track; dispatch: Dispatch }) {
  const launched = track.clips.find((clip) => clip.id === track.launchedClipId);
  if (!launched) return null;
  const back = timelineName(track);
  // In the clip's colour, as its chip in the rail is (DAW-47), which is its track's unless it has its own.
  const launchedColor = launched.color ?? track.color;
  const color = paletteAccent(launchedColor);
  return (
    <div className="absolute inset-0 bg-ground/60 pointer-events-none flex items-center px-2 z-10">
      <button
        type="button"
        // The lane's own gestures (place, select, drag) start on pointer down underneath.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => dispatch({ type: "launchClip", trackId: track.id, clipId: null })}
        title={`Stop ${launched.name} and play ${back} again`}
        style={{
          color,
          borderColor: paletteAccent(launchedColor, 0.5),
          // A tint over the ground, so it stays readable over the lane's notes.
          backgroundImage: `linear-gradient(${paletteAccent(launchedColor, 0.14)}, ${paletteAccent(launchedColor, 0.14)})`,
        }}
        className="pointer-events-auto inline-flex items-center gap-1.5 font-mono text-[10px] bg-ground/80 border rounded px-1.5 py-0.5 cursor-pointer hover:brightness-125"
      >
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />
        Playing {launched.name}
        <span className="text-muted">·</span>
        back to {back}
      </button>
    </div>
  );
}
