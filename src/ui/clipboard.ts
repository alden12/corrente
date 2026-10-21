/**
 * The one clipboard (DAW-74): whatever was copied last, wherever it was copied. The timeline, the clip
 * rail and the piano roll each used to keep their own, so a clip copied in the rail couldn't be pasted
 * on the timeline. Now a paste anywhere takes what's there if it can, and leaves the key alone if it
 * can't: a clip pastes onto the timeline or into the rail, notes into the roll.
 *
 * Module state, not a component's, so it outlives the remounts a track switch causes and carries a
 * copy from one track to another. Read and written through functions, never a mutable export.
 */
import type { ClipContent } from "../audio/project/types";

/** Notes as copied: each relative to the first, so a paste puts them anywhere. */
export interface CopiedNote {
  relStart: number;
  pitch: number;
  length: number;
  velocity: number;
}

/**
 * A clip, with where it came from (so a paste onto its own track places the same clip rather than a
 * copy) and, copied from the timeline, the window a placement showed of it.
 */
export interface CopiedClip {
  content: ClipContent;
  source: { trackId: string; clipId: string };
  window?: { offset: number; length: number };
}

type Copied = { kind: "clip"; clip: CopiedClip } | { kind: "notes"; notes: CopiedNote[] };

let copied: Copied | null = null;

export const copyClip = (clip: CopiedClip): void => {
  copied = { kind: "clip", clip };
};

export const copyNotes = (notes: CopiedNote[]): void => {
  copied = { kind: "notes", notes };
};

/** The copied clip, if what was copied last is one. */
export const copiedClip = (): CopiedClip | null => (copied?.kind === "clip" ? copied.clip : null);

/** The copied notes, if what was copied last is notes. */
export const copiedNotes = (): CopiedNote[] => (copied?.kind === "notes" ? copied.notes : []);
