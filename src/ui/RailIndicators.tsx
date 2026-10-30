/**
 * The app's state at the foot of the activity rail, above the account button (DAW-87): the sync
 * connection, where a standalone run keeps its files, and whether an agent is connected over MCP. They
 * say how the app stands, not the selected track, so they sit with the app's own controls rather
 * than in the workbench's tab bar, and the plugin's window, which reuses the rail, shows them too.
 * Each is an icon, the rail being 48px; a press opens its details beside it.
 */
import { mcpConnected, type McpStatus } from "../audio/mcp/bridge";
import { MCP_GUIDE_URL } from "../hosting";
import type { WsStatus } from "../contract/client";
import { SyncChip, type ChipPopover } from "./ConnectionStatus";
import { OnThisDeviceChip, onThisDevice, type Reminder } from "./hosting/OnThisDevice";

/** Beside the rail, to its right. */
const BESIDE: ChipPopover = { strategy: "beside", side: "right" };

// The built-in agent does not need MCP, so a missing connection is not a warning: an empty ring, not a
// red dot. It shows anyway, as the way to the setup (AGENT-37), which it opens whatever its state.
const MCP_DOT: Record<McpStatus, string> = {
  connected: "bg-good",
  standby: "bg-faint",
  connecting: "border border-faint",
  disconnected: "border border-faint",
};
// Connecting is what a missing server looks like between retries, so it reads as not connected.
const NOT_CONNECTED = "MCP not connected: how to connect an agent";
const MCP_TITLE: Record<McpStatus, string> = {
  connected: "MCP connected",
  standby: "MCP connected, but driving another tab: the one most recently in front",
  connecting: NOT_CONNECTED,
  disconnected: NOT_CONNECTED,
};

export function RailIndicators({
  mcpStatus,
  syncStatus,
  syncShared = false,
  onRevealProject,
  backupReminder,
}: {
  mcpStatus: McpStatus;
  /** The sync connection, or null in local (no-sync) mode. */
  syncStatus: WsStatus | null;
  /** The open project has collaborators, which the chip warns of while offline. */
  syncShared?: boolean;
  /** Open the open project's own page (its Export button), from "Saved in browser". */
  onRevealProject?: () => void;
  /** The open project's log and export, for the backup reminder. */
  backupReminder?: Reminder;
}) {
  return (
    <div className="flex flex-col items-center w-full">
      <a
        href={MCP_GUIDE_URL}
        target="_blank"
        rel="noreferrer"
        title={MCP_TITLE[mcpStatus]}
        aria-label={MCP_TITLE[mcpStatus]}
        className={`flex flex-col items-center gap-1 w-full py-1.5 font-mono text-[9px] hover:text-ink ${
          mcpConnected(mcpStatus) ? "text-muted" : "text-faint"
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${MCP_DOT[mcpStatus]}`} />
        MCP
      </a>
      {onThisDevice && onRevealProject && (
        <OnThisDeviceChip onShowProject={onRevealProject} reminder={backupReminder} icon popover={BESIDE} />
      )}
      {syncStatus && <SyncChip status={syncStatus} shared={syncShared} icon popover={BESIDE} />}
    </div>
  );
}
