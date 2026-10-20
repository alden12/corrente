/**
 * What the MCP tools read and edit through, so the same tools can drive two very different things
 * (AGENT-28): a browser tab over a local WebSocket, where the tab owns the project and the audio, and
 * a project stored on the sync service, where nobody is listening but the room.
 */
import type { ProjectStore } from "../../src/audio/project/projectStore";
import type { DeviceEdit, HistoryMethod, PatchMethod, ServerToBrowser } from "../../src/audio/mcp/protocol";
import type { DeviceAnalysisRequest } from "../../src/audio/analysis/deviceAlone";
import type { MixAnalysisRequest } from "../../src/audio/analysis/mixScope";

/** A round-trip's answer: the tab's `historyReply` / `patchReply`, or the hosted equivalent. */
export type Reply = { ok: boolean; result?: unknown; error?: string };

export interface DawTarget {
  /** The project as the tools should read it. A getter, because the hosted target swaps it per call. */
  readonly project: ProjectStore;
  /**
   * Hand a message to whatever applies it. Durable ones are edit commands; the rest (selection, live
   * notes, transport, feed notes) are the tab's business. False when nothing could take it.
   */
  send(message: ServerToBrowser): boolean;
  /**
   * Land a device edit, and say whether it landed. The tab keeps the device in the library first
   * (COMM-1.11.2) and answers with why it couldn't, if it couldn't.
   */
  landDevice(edit: DeviceEdit): Promise<Reply>;
  /** Whether `send` has somewhere to go right now. */
  connected(): boolean;
  /** Version history, which the tab keeps and the hosted target answers from the log. */
  requestHistory(method: HistoryMethod, params?: Record<string, unknown>): Promise<Reply>;
  /** The patch library. */
  requestPatch(method: PatchMethod, params?: Record<string, unknown>): Promise<Reply>;
  /**
   * Render the project on the engine render core and measure the mix (AGENT-4.9): the tab renders
   * it in its worker, the hosted server on a worker thread; some tracks or a window of it when asked
   * (AGENT-4.4). Answers a `MixReport`.
   */
  analyzeMix(request: MixAnalysisRequest): Promise<Reply>;
  /** One track's sound alone, rendered and measured the same way (AGENT-4.6). Answers a `DeviceAnalysis`. */
  analyzeDevice(request: DeviceAnalysisRequest): Promise<Reply>;
}
