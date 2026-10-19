/** MCP tools: listening to the mix (AGENT-4.9), rendered on the engine render core and measured. */
import { ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerAnalysisTools({ server, target }: ToolContext): void {
  server.registerTool(
    "analyze_mix",
    {
      title: "Analyze mix",
      description:
        "Render the whole arrangement (the audio the user would hear) and measure it, naming the project it heard: peak level and headroom (dBFS) " +
        "going into the master, whether it clips, and overall loudness (RMS dBFS), with a plain-language note. " +
        "Anything the render couldn't play is listed under `omitted`. Use it to check your work - that the mix " +
        "isn't clipping, too quiet or too hot - before telling the user you're done.",
      inputSchema: {},
    },
    async () => {
      try {
        const reply = await target.analyzeMix();
        if (!reply.ok) return fail(reply.error ?? "Couldn't analyze the mix.");
        // Named, so it's clear which project was heard: the local server hears whatever the tab has open.
        return ok(JSON.stringify({ project: target.project.name, ...(reply.result as object) }, null, 2));
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
