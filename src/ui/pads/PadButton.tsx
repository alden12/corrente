/**
 * One pad (MOBILE-6). Shared by the scale pads and a kit's own pads so a press, a chord
 * and a latch look the same wherever you are playing.
 *
 * `touch-action: none` is not decoration: without it the browser claims the vertical drag
 * for scrolling before the first move event arrives, and the sustain gesture never happens.
 */
import { useRef, type CSSProperties, type ReactNode } from "react";
import { padKey, type PadNotes, type PadTouch } from "./usePadTouch";
import type { ChordMood, HintStrength } from "../../audio/theory/chordMoves";
import type { PadHint } from "./chordHints";
import { KeyChangeBubble } from "./KeyChangeBubble";

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
 * A next-chord hint (DAW-12.2): the whole pad tinted, as a chess board lights a piece's squares. One
 * green, deeper for a strong move, none of it the teal a press and a star wear, so a hint never looks
 * held. A chord leading to a new key (DAW-12.3) lights the same, plus a small arrow in its corner in
 * the ink colour (white on a dark ground), unlike any dot. It takes the place of a star's tint, whose ★
 * caption still says it's starred. Spelled out whole, so Tailwind sees every class.
 */
const HINT_FILL: Record<HintStrength, string> = { strong: "bg-good/30", good: "bg-good/12" };
/**
 * The chord's mood (DAW-12.4), as a dot in the pad's corner. None for bright, the plain major chord most
 * moves land on (2026-11-04, Alden), so a dot says the chord is something else.
 */
const MOOD_DOT: Record<ChordMood, string | null> = {
  bright: null,
  sad: "bg-mood-sad",
  tense: "bg-mood-tense",
  dark: "bg-mood-dark",
};
const describeHint = ({ strength, mood, keyChange }: PadHint) =>
  `A ${strength} next chord${mood ? `, ${mood}` : ""}${keyChange ? ", leading to a new key" : ""}`;

/** A key change a held pad offers, above it (DAW-12.3). */
export interface PadKeyChange {
  /** The key, as the menu writes it: "G major". */
  label: string;
  take: () => void;
}

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
  keyChange,
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
  hint?: PadHint | null;
  /** The key it leads to, offered above it while it's held. */
  keyChange?: PadKeyChange | null;
}) {
  const self = useRef<HTMLButtonElement>(null);
  const sounding = !editing && touch.isSounding(pitches);
  const latched = !editing && touch.isLatched(pitches);
  const editClass = editing
    ? `outline-1 outline-dashed -outline-offset-1 ${editing.selected ? "outline-you outline-2" : "outline-line"} ${editing.hidden ? "opacity-40" : ""}`
    : "";
  return (
    <button
      ref={self}
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
        sounding ? "bg-you/30 text-you" : `${hint ? HINT_FILL[hint.strength] : toneFill(tone)} ${TONE_TEXT[tone]}`
      } ${latched ? "ring-1 ring-inset ring-you" : ""} ${hint?.mood || hint?.keyChange ? "relative" : ""} ${editClass} ${className}`}
      style={style}
    >
      {/* Capped at the pad's width, so a label too long even shrunk (a kit pad's sample name) ellipsises
          inside its pad rather than spilling over the next one (DAW-8.19). */}
      <span className="max-w-full truncate font-mono text-[12px] font-semibold" style={{ fontSize: labelSize(label) }}>
        {label}
      </span>
      {sublabel && <span className="mt-0.5 font-mono text-[9px] text-faint">{sublabel}</span>}
      {/* Positioned only then: only a chord pad has a hint, never an accidental, which positions itself.
          The mood's dot top left, faint, and a key change's arrow top right, so the two never meet. */}
      {hint?.mood && MOOD_DOT[hint.mood] && (
        <span
          aria-hidden="true"
          className={`absolute top-1 left-1 w-1 h-1 rounded-full opacity-70 pointer-events-none ${MOOD_DOT[hint.mood]}`}
        />
      )}
      {hint?.keyChange && (
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="absolute top-1 right-1 w-2.5 h-2.5 text-ink pointer-events-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 12 12 4M6 4h6v6" />
        </svg>
      )}
      {sounding && keyChange && <KeyChangeBubble anchor={self} label={keyChange.label} onTake={keyChange.take} />}
    </button>
  );
}
