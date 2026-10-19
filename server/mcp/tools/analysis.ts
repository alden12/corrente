/** MCP tools: listening to the mix and to one sound (AGENT-4.9, AGENT-4.6), rendered on the engine render core and measured. */
import { z } from "zod";
import { ok, fail, type ToolResult } from "../shared";
import type { ToolContext } from "../context";
import type { DeviceAnalysis } from "../../../src/audio/analysis/analyzeDevice";
import {
  ANALYZE_DEVICE_DOC,
  ANALYZE_MIX_DOC,
  PICTURE_DOC,
  deviceAnalysisArgs,
} from "../../../src/audio/analysis/toolDocs";

export function registerAnalysisTools({ server, target, trackArg, resolveTrack }: ToolContext): void {
  server.registerTool(
    "analyze_mix",
    {
      title: "Analyze mix",
      description: `${ANALYZE_MIX_DOC} The report names the project it heard.`,
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

  server.registerTool(
    "analyze_device",
    {
      title: "Analyze a track's sound",
      description: `${ANALYZE_DEVICE_DOC} ${PICTURE_DOC}`,
      inputSchema: {
        ...trackArg,
        ...deviceAnalysisArgs,
        picture: z.boolean().optional(),
      },
    },
    async ({ track, play, through, picture }): Promise<ToolResult> => {
      const resolved = resolveTrack(track);
      if ("error" in resolved) return fail(resolved.error);
      try {
        const reply = await target.analyzeDevice({ track: resolved.id, play, through, picture });
        if (!reply.ok) return fail(reply.error ?? "Couldn't analyze the sound.");
        const { summary, picture: png } = reply.result as DeviceAnalysis;
        const text = JSON.stringify({ track: resolved.track.name, ...summary }, null, 2);
        return {
          content: [
            { type: "text", text },
            ...(png ? [{ type: "image" as const, data: png, mimeType: "image/png" }] : []),
          ],
        };
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
