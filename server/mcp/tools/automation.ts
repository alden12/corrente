/**
 * MCP tools: automation (DAW-67.3), from the definitions the in-app agent shares
 * (src/audio/automation/tools.ts). Each edit goes to the tab, then onto this server's mirror.
 */
import { AUTOMATION_TOOLS } from "../../../src/audio/automation/tools";
import { applyEdit } from "../../../src/audio/commands/applyEdit";
import { UNATTRIBUTED_AGENT } from "../../../src/audio/commands/authors";
import { ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerAutomationTools({ server, target, trackArg, resolveTrack }: ToolContext): void {
  for (const tool of AUTOMATION_TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: { ...trackArg, ...tool.input } },
      async ({ track, ...args }: { track?: string } & Record<string, unknown>) => {
        const resolved = resolveTrack(track);
        if ("error" in resolved) return fail(resolved.error);
        try {
          const { command, reply } = tool.run(target.project, resolved.track, args);
          if (command) {
            if (!target.send(command)) return fail(target.whyNotConnected());
            // The mirror is this server's read-back copy; the tab authors the real edit.
            applyEdit(target.project, command, UNATTRIBUTED_AGENT);
          }
          return ok(JSON.stringify(reply, null, 2));
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
      },
    );
  }
}
