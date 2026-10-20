/**
 * What the listening tools tell a model, shared by the MCP servers and the in-app agent so the two
 * can't drift (AGENT-4.6). Each adds only what is its own: the MCP tools name the project they heard
 * and can return the spectrogram picture, which the in-app chat (text only) can't carry.
 */
import { z } from "zod";
import { PHRASE_NAMES, PHRASES } from "./phrases";

const SOUND_MEASURES =
  "octave-band balance (dBFS RMS by band centre), spectral centroid (low is dark, high is bright) and stereo " +
  "correlation (1 mono, 0 wide)";

export const ANALYZE_MIX_DOC =
  "Render the arrangement (the audio the user would hear) and measure it: peak level and headroom (dBFS) " +
  "going into the master, whether it clips, overall loudness (RMS dBFS) with a plain-language note, and " +
  `${SOUND_MEASURES}. Anything the render couldn't play is listed under \`omitted\`. Use it to check your work - ` +
  "that the mix isn't clipping, too quiet or too hot - before telling the user you're done. " +
  "To answer a narrower question, render less: `tracks` hears just those tracks as they sit in the mix (through " +
  "their groups, ignoring mute and solo; analyze_device hears one dry), and `from`/`to` a window in beats, like " +
  "a note's start (bar N starts at (N-1) x beats per bar). A window plays in from a few seconds before it, so " +
  "held notes and reverb tails are there from its start.";

const phraseList = PHRASE_NAMES.map((name) => `"${name}" (${PHRASES[name].says})`).join(", ");

export const ANALYZE_DEVICE_DOC =
  "Render one track's sound on its own - its MIDI devices, instrument and effects, without the rest of the mix, " +
  `its groups' effects or its fader - and measure it: levels (as analyze_mix), ${SOUND_MEASURES}. Use it ` +
  "to check a sound you're designing does what you meant, and compare the numbers before and after a change. " +
  `\`play\`: its own notes ("track", the default when it has any, up to 32 beats), or a phrase that suits its ` +
  `role, at the project's tempo: ${phraseList}. Pick the phrase for its role: chords make a lead read like a pad. ` +
  '`through`: an effect id to hear the chain only up to and including it, or "instrument" for the instrument alone.';

/** The picture, which only the MCP tools can return. */
export const PICTURE_DOC =
  "`picture: true` adds a spectrogram image with labelled axes, where filter sweeps, envelopes, vibrato, detune, " +
  "noise and mud show; read it for mechanics (what changes where). It costs more tokens, so ask for it when the " +
  "numbers aren't enough.";

/** analyze_mix's arguments besides the tracks, which each side names its own way. */
export const mixAnalysisArgs = {
  from: z.number().min(0).optional(),
  to: z.number().positive().optional(),
};

/** analyze_device's arguments besides the track, which each side names its own way. */
export const deviceAnalysisArgs = {
  play: z.enum(["track", ...PHRASE_NAMES]).optional(),
  through: z.string().optional(),
};
