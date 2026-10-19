/**
 * The agent's "ears" (AGENT-4.1): tools that render the project offline and measure the result,
 * so the agent can judge its own output instead of reasoning blind on symbolic data. Renders on the
 * engine render core in a worker (renderInWorker, AGENT-4.9), the engine the user hears, then reports objective measures (peak,
 * clipping, loudness). This is the grounded verify tool - the loop calls it, hears the mix, and
 * continues. See the agent design notes.
 */
import { z } from "zod";
import { defineTool, type ToolContext } from "./factory";
import { analyzeProjectMix, analyzeTrackDevice } from "../../engine/renderInWorker";
import { PHRASE_NAMES, PHRASES } from "../../analysis/phrases";

const phraseList = PHRASE_NAMES.map((name) => `"${name}" (${PHRASES[name].says})`).join(", ");

export function analysisTools(context: ToolContext) {
  return [
    defineTool({
      name: "analyze_mix",
      description:
        "Render the whole project offline (the exact audio the user would hear) and measure its master output: " +
        "peak level and headroom (dBFS), whether it is clipping, and overall loudness (RMS dBFS). Use it to check " +
        "your work - that the mix is not clipping and not too quiet or too hot - before telling the user you are done.",
      schema: z.object({}),
      run: () => analyzeProjectMix(context.projectStore),
    }),
    // The same as the MCP tool (AGENT-4.6), less the picture: this chat carries text only.
    defineTool({
      name: "analyze_device",
      description:
        "Render one track's sound on its own (its MIDI devices, instrument and effects, without the rest of the mix) " +
        "and measure it: levels, octave-band balance (dBFS RMS by band centre), spectral centroid (low is dark, high " +
        "is bright) and stereo correlation (1 mono, 0 wide). Use it to check a sound you're designing. " +
        `\`play\`: its own notes ("track", the default when it has any), or a phrase for its role: ${phraseList}. ` +
        '`through`: an effect id to hear the chain only up to it, or "instrument" for the instrument alone.',
      schema: z.object({
        trackId: z.string().optional(),
        play: z.enum(["track", ...PHRASE_NAMES]).optional(),
        through: z.string().optional(),
      }),
      run: async ({ trackId, play, through }) => {
        const track = context.resolveTrack(trackId);
        const { summary } = await analyzeTrackDevice(context.projectStore, { track: track.id, play, through });
        return { track: track.name, ...summary };
      },
    }),
  ];
}
