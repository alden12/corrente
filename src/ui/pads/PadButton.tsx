/**
 * One pad (MOBILE-6). Shared by the scale pads and a kit's own pads so a press, a chord
 * and a latch look the same wherever you are playing.
 *
 * `touch-action: none` is not decoration: without it the browser claims the vertical drag
 * for scrolling before the first move event arrives, and the sustain gesture never happens.
 */
import type { CSSProperties, ReactNode } from "react";
import { padKey, type PadNotes, type PadTouch } from "./usePadTouch";
import type { ChordHint } from "../../audio/theory/chordMoves";

/**
 * Fill, not outline. Every pad wears the same grey and they are separated by the gaps between
 * them rather than by borders, which is what makes a bank read as a row of keys instead of a
 * grid with lines ruled through it. What differs per tone is the *label* colour, so the pads
 * stay one object and the tonic still says where home is.
 */
const TONE_CLASS = {
  /** The tonic reads as home without shouting: the same pad, its label tinted. */
  tonic: "bg-control text-you",
  "in-scale": "bg-control text-ink",
  /** Out of the scale, so it sits back the way a black key does. */
  accidental: "bg-control text-muted",
  /** A starred chord: tinted, so your go-to chords stand out while you play. */
  favourite: "bg-you/25 text-ink",
} as const;

/**
 * A pad being arranged rather than played (the chord editor): a tap selects it, and it does not
 * sound. Dashed, so the mode is plain from the pads themselves and nobody wonders why they are silent.
 */
export interface PadEditing {
  onSelect: () => void;
  selected: boolean;
  /** Hidden from play, shown here so it can be brought back. */
  hidden: boolean;
}

/**
 * A next-chord hint (DAW-12.2): a dot at the top of the pad, as a chess board dots a piece's moves.
 * A dot rather than a fill or a ring, which a star, a press and a latch already wear.
 */
const HINT_DOT = { strong: "size-2 bg-you", good: "size-1.5 bg-you/45" } as const;
const HINT_DESCRIPTION = { strong: "A strong next chord", good: "A good next chord" } as const;

/** Roughly how wide a monospace character is, as a share of the font size. */
const MONO_CHAR_WIDTH = 0.62;

/**
 * The label's font size: 12px, shrunk to fit the pad when a long name would overflow it - a chord
 * like `F#madd9` on a phone. Pure CSS, from the pad's own width (`cqi`, the pad being a size
 * container) and the label's length, so it follows a rotation or a resize with no measuring.
 */
const labelSize = (label: ReactNode) =>
  typeof label === "string"
    ? `min(12px, calc((100cqi - 6px) / ${Math.max(1, label.length) * MONO_CHAR_WIDTH}))`
    : undefined;

export function PadButton({
  name,
  label,
  sublabel,
  tone = "in-scale",
  touch,
  pitches,
  className = "",
  style,
  editing,
  hint,
}: {
  /** What it is, for the accessibility tree and for tests: a note name, or a kit pad's sample. */
  name: string;
  /** The big glyph - an interval, or a kit pad's number. */
  label: ReactNode;
  /** The quiet one beneath it. */
  sublabel?: string;
  tone?: keyof typeof TONE_CLASS;
  touch: PadTouch;
  /** What it plays: one note, or a chord's. */
  pitches: PadNotes;
  className?: string;
  style?: CSSProperties;
  editing?: PadEditing;
  /** How good it would sound next, after the chord last played (chord pads only). */
  hint?: ChordHint | null;
}) {
  const sounding = !editing && touch.isSounding(pitches);
  const latched = !editing && touch.isLatched(pitches);
  const editClass = editing
    ? `outline-1 outline-dashed -outline-offset-1 ${editing.selected ? "outline-you outline-2" : "outline-line"} ${editing.hidden ? "opacity-40" : ""}`
    : "";
  return (
    <button
      type="button"
      aria-label={name}
      // Described, not named, so a hint never changes what the pad is called.
      aria-description={hint ? HINT_DESCRIPTION[hint] : undefined}
      aria-pressed={editing ? editing.selected : sounding}
      data-pitches={padKey(pitches)}
      {...(editing ? { onClick: editing.onSelect } : touch.padProps(pitches))}
      // No position utility here: the accidentals position themselves absolutely, and two
      // Tailwind classes for the same property are settled by stylesheet order rather than
      // by which one the caller passed - so the base class would win at random.
      //
      // A size container, so the label can shrink to the pad's width (`labelSize`).
      //
      // The radius *is* here, because every pad everywhere has the same one; only size and
      // position are the caller's business.
      className={`[container-type:inline-size] flex flex-col items-center justify-center rounded-md leading-none select-none ${editing ? "touch-pan-y" : "touch-none"} cursor-pointer transition-colors ${
        sounding ? "bg-you/30 text-you" : TONE_CLASS[tone]
      } ${latched ? "ring-1 ring-inset ring-you" : ""} ${hint ? "relative" : ""} ${editClass} ${className}`}
      style={style}
    >
      {/* Capped at the pad's width, so a label too long even shrunk (a kit pad's sample name) ellipsises
          inside its pad rather than spilling over the next one (DAW-8.19). */}
      <span className="max-w-full truncate font-mono text-[12px] font-semibold" style={{ fontSize: labelSize(label) }}>
        {label}
      </span>
      {sublabel && <span className="mt-0.5 font-mono text-[9px] text-faint">{sublabel}</span>}
      {/* Positioned only when hinted: only a chord pad is, and never an accidental, which positions itself. */}
      {hint && (
        <span
          aria-hidden="true"
          className={`absolute top-1 left-1/2 -translate-x-1/2 rounded-full pointer-events-none ${HINT_DOT[hint]}`}
        />
      )}
    </button>
  );
}
