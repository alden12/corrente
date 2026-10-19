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
import { ANALYZE_DEVICE_DOC, ANALYZE_MIX_DOC, deviceAnalysisArgs } from "../../analysis/toolDocs";

export function analysisTools(context: ToolContext) {
  return [
    defineTool({
      name: "analyze_mix",
      description: ANALYZE_MIX_DOC,
      schema: z.object({}),
      run: () => analyzeProjectMix(context.projectStore),
    }),
    // The MCP tool's text and arguments (toolDocs.ts), less the picture: this chat carries text only.
    defineTool({
      name: "analyze_device",
      description: ANALYZE_DEVICE_DOC,
      schema: z.object({
        trackId: z.string().optional(),
        ...deviceAnalysisArgs,
      }),
      run: async ({ trackId, play, through }) => {
        const track = context.resolveTrack(trackId);
        const { summary } = await analyzeTrackDevice(context.projectStore, { track: track.id, play, through });
        return { track: track.name, ...summary };
      },
    }),
  ];
}
