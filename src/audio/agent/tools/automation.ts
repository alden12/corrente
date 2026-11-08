/**
 * The automation tools (DAW-67.3) for the in-app agent: the shared definitions (automation/tools.ts),
 * each taking the agent's optional track and dispatching its edit as the agent.
 */
import { z } from "zod";
import type { AgentTool } from "../types";
import { AUTOMATION_TOOLS } from "../../automation/tools";
import { defineTool, type ToolContext } from "./factory";

export function automationTools({ projectStore, dispatch, resolveTrack }: ToolContext): AgentTool[] {
  return AUTOMATION_TOOLS.map((tool) =>
    defineTool({
      name: tool.name,
      description: tool.description,
      schema: z.object({ track: z.string().optional(), ...tool.input }),
      run: ({ track, ...args }) => {
        const { command, reply } = tool.run(projectStore, resolveTrack(track as string | undefined), args);
        if (command) dispatch(command);
        return reply;
      },
    }),
  );
}
