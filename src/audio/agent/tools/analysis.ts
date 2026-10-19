/**
 * The agent's "ears" (AGENT-4.1): tools that render the project offline and measure the result,
 * so the agent can judge its own output instead of reasoning blind on symbolic data. Renders on the
 * engine render core in a worker (renderInWorker, AGENT-4.9), the engine the user hears, then reports objective measures (peak,
 * clipping, loudness). This is the grounded verify tool - the loop calls it, hears the mix, and
 * continues. See the agent design notes.
 */
import { z } from "zod";
import { defineTool, type ToolContext } from "./factory";
import { analyzeProjectMix } from "../../engine/renderInWorker";

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
  ];
}
