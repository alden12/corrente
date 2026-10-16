/**
 * A glance at a clip's notes, squeezed into whatever box holds it: the minimised editor's bar
 * (MOBILE-19.1), so a parked sheet still says which clip is under it, the clip rail's chips, and a
 * folded roll's header on desktop (DAW-61.1).
 *
 * Drawn in beats and pitch rows straight into the viewBox and stretched to the bar, so there is
 * no measuring and it follows the clip live (`useClip`) as notes are recorded.
 */
import type { ReactNode } from "react";
import { previewWindow } from "./previewWindow";
import { useClip } from "../../audio/sequencer/useClip";
import type { ClipStore } from "../../audio/sequencer/clipStore";

/** Head and foot room in the bar, as a share of its height, so the outer notes are not clipped. */
const MARGIN = 0.12;

export function ClipPreview({
  store,
  name,
  beatsPerBar,
  bars,
  empty = <span className="block px-2 truncate font-mono text-[10px] text-faint">{name} · empty</span>,
}: {
  store: ClipStore;
  name: string;
  /** The project's bar, so the cap is in bars of its time signature. */
  beatsPerBar: number;
  /** The most bars it shows; past them it fades out (`PREVIEW_BARS` unless a wider box asks for more). */
  bars?: number;
  /** What to show for a clip with no notes. The clip rail's chips show nothing. */
  empty?: ReactNode;
}) {
  const clip = useClip(store);
  const { length, continues } = previewWindow(clip.lengthBeats, beatsPerBar, bars);
  const notes = clip.notes.filter((note) => note.start >= 0 && note.start < length);
  if (length <= 0 || notes.length === 0) return empty;

  const pitches = notes.map((note) => note.pitch);
  const lowest = Math.min(...pitches);
  const rows = Math.max(...pitches) - lowest + 1;
  const rowHeight = (1 - 2 * MARGIN) / rows;
  return (
    <svg
      viewBox={`0 0 ${length} 1`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Clip ${name}, ${notes.length} notes`}
      className="block w-full h-full"
      style={continues ? { maskImage: "linear-gradient(to right, black 75%, transparent)" } : undefined}
    >
      {notes.map((note) => (
        <rect
          key={note.id}
          x={note.start}
          width={Math.max(length / 120, note.length - length / 200)}
          y={MARGIN + (rows - 1 - (note.pitch - lowest)) * rowHeight}
          // Never thinner than a hairline, however many rows a wide clip spans.
          height={Math.max(rowHeight * 0.8, 0.06)}
          fill="var(--color-you)"
        />
      ))}
    </svg>
  );
}
