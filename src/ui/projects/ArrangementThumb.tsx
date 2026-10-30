import type { ProjectSummary } from "../../audio/projects/summary";
import { colorAt } from "../../audio/deviceColors";
import { paletteAccent } from "../deviceColor";

/**
 * A project's arrangement in miniature (MOBILE-19.3): one lane per track, each clip a block, drawn
 * straight from its summary with no render. `playhead` marks a beat with a line (the open project's).
 */
export function ArrangementThumb({
  summary,
  width,
  height,
  playhead,
  className = "",
}: {
  summary: ProjectSummary | null | undefined;
  width: number | string;
  height: number;
  playhead?: number;
  className?: string;
}) {
  const lanes = summary?.lanes ?? [];
  const span = Math.max(1, summary?.spanBeats ?? 1);
  // Lanes share the height evenly inside a small margin, but never more than a quarter each, so a
  // one-track sketch reads as one lane rather than a solid slab.
  const margin = Math.max(2, height * 0.06);
  const inner = height - margin * 2;
  const laneHeight = lanes.length > 0 ? Math.min(inner / lanes.length, inner / 4) : 0;
  const percent = (beats: number) => `${(beats / span) * 100}%`;
  return (
    <span
      aria-hidden="true"
      className={`relative block shrink-0 overflow-hidden rounded-md bg-stage ${className}`}
      style={{ width, height }}
    >
      {lanes.flatMap((clips, lane) =>
        clips.map(([start, length], index) => (
          <span
            key={`${lane}-${index}`}
            className="absolute rounded-[2px] opacity-90"
            style={{
              left: percent(start),
              width: `max(2px, calc(${percent(length)} - 1.5px))`,
              top: margin + lane * laneHeight + 0.5,
              height: Math.max(1, laneHeight - 2),
              // Each clip's colour (DAW-47); a summary from before colours has none, so by its lane.
              background: paletteAccent(summary?.colors?.[lane]?.[index] ?? colorAt(lane)),
            }}
          />
        )),
      )}
      {playhead !== undefined && (
        <span className="absolute top-0 bottom-0 w-0.5 bg-ink/70" style={{ left: percent(playhead) }} />
      )}
    </span>
  );
}
