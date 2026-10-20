/**
 * What some tags mean in sound (AGENT-4.16): for a tag, the words that ask for it, how to build it on
 * the engine's blocks, and what analyze_device shows when it landed. The sound-design cookbook, kept
 * on tags so it shares their vocabulary: looking a brief's words up (`list_patches` with `tags`)
 * returns the patches carrying them as worked examples, and these notes beside them.
 *
 * Most tags have no note and needn't: tags are any string. It's data (tagNotes.json) so it can be
 * served beside the device library later (HOST-26); a test checks every block a note names exists.
 */
import { z } from "zod";
import notes from "./tagNotes.json";

const tagNoteSchema = z.object({
  /** Words that mean this tag, which a lookup resolves to it. */
  synonyms: z.array(z.string()),
  /** How to build it. */
  note: z.string(),
  /** The blocks the note uses. */
  blocks: z.array(z.string()),
  /** What analyze_device shows when it worked. */
  check: z.string(),
});

export type TagNote = z.infer<typeof tagNoteSchema>;

export const TAG_NOTES: Record<string, TagNote> = z.record(z.string(), tagNoteSchema).parse(notes);
