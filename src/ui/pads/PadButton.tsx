/**
 * One pad (MOBILE-6). Shared by the scale pads and a kit's own pads so a press, a chord
 * and a latch look the same wherever you are playing.
 *
 * `touch-action: none` is not decoration: without it the browser claims the vertical drag
 * for scrolling before the first move event arrives, and the sustain gesture never happens.
 */
import type { CSSProperties, ReactNode } from "react";
import { padKey, type PadNotes, type PadTouch } from "./usePadTouch";
import type { ChordHint, ChordMood, HintStrength } from "../../audio/theory/chordMoves";

/**
 * Fill, not outline. Every pad wears the same grey and they are separated by the gaps between
 * them rather than by borders, which is what makes a bank read as a row of keys instead of a
 * grid with lines ruled through it. What differs per tone is the *label* colour, so the pads
 * stay one object and the tonic still says where home is.
 */
const TONE_TEXT = {
  /** The tonic reads as home without shouting: the same pad, its label tinted. */
  tonic: "text-you",
  "in-scale": "text-ink",
  /** Out of the scale, so it sits back the way a black key does. */
  accidental: "text-muted",
  /** A starred chord: tinted, so your go-to chords stand out while you play. */
  favourite: "text-ink",
} as const;
type Tone = keyof typeof TONE_TEXT;
const toneFill = (tone: Tone) => (tone === "favourite" ? "bg-you/25" : "bg-control");

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
 * A next-chord hint (DAW-12.2): the whole pad tinted, as a chess board lights a piece's squares. Its
 * colour is the chord's mood (DAW-12.4), deeper for a strong move, none of them the teal a press and a
 * star wear, so a hint never looks held. It takes the place of a star's tint, whose ★ caption still says
 * it's starred. Spelled out whole, so Tailwind sees every class.
 */
const HINT_FILL: Record<ChordMood, Record<HintStrength, string>> = {
  bright: { strong: "bg-mood-bright/30", good: "bg-mood-bright/12" },
  sad: { strong: "bg-mood-sad/30", good: "bg-mood-sad/12" },
  tense: { strong: "bg-mood-tense/30", good: "bg-mood-tense/12" },
  dark: { strong: "bg-mood-dark/30", good: "bg-mood-dark/12" },
};
const describeHint = ({ strength, mood, keyChange }: ChordHint) =>
  `A ${strength} next chord, ${mood}${keyChange ? ", leading to a new key" : ""}`;

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
  tone?: Tone;
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
      aria-description={hint ? describeHint(hint) : undefined}
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
        sounding
          ? "bg-you/30 text-you"
          : `${hint ? HINT_FILL[hint.mood][hint.strength] : toneFill(tone)} ${TONE_TEXT[tone]}`
      } ${latched ? "ring-1 ring-inset ring-you" : ""} ${hint?.keyChange ? "relative" : ""} ${editClass} ${className}`}
      style={style}
    >
      {/* Capped at the pad's width, so a label too long even shrunk (a kit pad's sample name) ellipsises
          inside its pad rather than spilling over the next one (DAW-8.19). */}
      <span className="max-w-full truncate font-mono text-[12px] font-semibold" style={{ fontSize: labelSize(label) }}>
        {label}
      </span>
      {sublabel && <span className="mt-0.5 font-mono text-[9px] text-faint">{sublabel}</span>}
      {/* A key change (DAW-12.3): an orange arrow in the corner, beside the mood's fill rather than
          instead of it. Positioned only then: only a chord pad leads to a key, never an accidental,
          which positions itself. */}
      {hint?.keyChange && (
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="absolute top-1 right-1 w-3.5 h-3.5 text-hot pointer-events-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 12 12 4M6 4h6v6" />
        </svg>
      )}
    </button>
  );
}
