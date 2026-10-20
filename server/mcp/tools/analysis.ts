/** MCP tools: listening to the mix and to one sound (AGENT-4.9, AGENT-4.6), rendered on the engine render core and measured. */
import { z } from "zod";
import { fail, type ToolResult } from "../shared";
import type { ToolContext } from "../context";
import type { SoundAnalysis } from "../../../src/audio/analysis/analyzeSound";
import {
  ANALYZE_DEVICE_DOC,
  ANALYZE_MIX_DOC,
  PICTURE_DOC,
  deviceAnalysisArgs,
  mixAnalysisArgs,
} from "../../../src/audio/analysis/toolDocs";

/** A report as text, led by `named`, with its picture after it when there is one. */
function soundResult(named: Record<string, string>, { summary, picture }: SoundAnalysis<object>): ToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify({ ...named, ...summary }, null, 2) },
      ...(picture ? [{ type: "image" as const, data: picture, mimeType: "image/png" }] : []),
    ],
  };
}

export function registerAnalysisTools({ server, target, trackArg, resolveTrack }: ToolContext): void {
  server.registerTool(
    "analyze_mix",
    {
      title: "Analyze mix",
      description: `${ANALYZE_MIX_DOC} ${PICTURE_DOC} The report names the project it heard.`,
      inputSchema: {
        tracks: z.array(z.string()).optional().describe("track ids to hear; every track when absent"),
        ...mixAnalysisArgs,
        picture: z.boolean().optional(),
      },
    },
    async ({ tracks, from, to, picture }): Promise<ToolResult> => {
      const resolved = (tracks ?? []).map((track) => resolveTrack(track));
      const unknown = resolved.find((entry): entry is { error: string } => "error" in entry);
      if (unknown) return fail(unknown.error);
      try {
        const ids = resolved.map((entry) => (entry as { id: string }).id);
        const reply = await target.analyzeMix({ tracks: ids.length ? ids : undefined, from, to, picture });
        if (!reply.ok) return fail(reply.error ?? "Couldn't analyze the mix.");
        // Named, so it's clear which project was heard: the local server hears whatever the tab has open.
        return soundResult({ project: target.project.name }, reply.result as SoundAnalysis<object>);
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
        return soundResult({ track: resolved.track.name }, reply.result as SoundAnalysis<object>);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
