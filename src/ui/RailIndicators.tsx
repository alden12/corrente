/**
 * The app's state at the foot of the activity rail, above the account button (DAW-87): the sync
 * connection, where a standalone run keeps its files, and whether Claude is connected over MCP. They
 * say how the app stands, not the selected track, so they sit with the app's own controls rather
 * than in the workbench's tab bar, and the plugin's window, which reuses the rail, shows them too.
 * Each is an icon, the rail being 48px; a press opens its details beside it.
 */
import type { McpStatus } from "../audio/mcp/bridge";
import type { WsStatus } from "../contract/client";
import { SyncChip, type ChipPopover } from "./ConnectionStatus";
import { OnThisDeviceChip, onThisDevice, type Reminder } from "./hosting/OnThisDevice";

/** Beside the rail, to its right. */
const BESIDE: ChipPopover = { strategy: "beside", side: "right" };

// The built-in agent does not need MCP, so a missing connection is not a warning: it shows only when
// connected (green), or connected but driving another tab (grey).
const MCP_DOT: Record<McpStatus, string> = {
  connected: "bg-good",
  connecting: "bg-faint",
  standby: "bg-faint",
  disconnected: "bg-faint",
};
const MCP_TITLE: Record<McpStatus, string> = {
  connected: "MCP connected",
  connecting: "MCP connecting…",
  standby: "MCP connected, but driving another tab: the one most recently in front",
  disconnected: "MCP disconnected",
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
      {(mcpStatus === "connected" || mcpStatus === "standby") && (
        <span
          role="status"
          title={MCP_TITLE[mcpStatus]}
          aria-label={MCP_TITLE[mcpStatus]}
          className="flex flex-col items-center gap-1 py-1.5 font-mono text-[9px] text-muted"
        >
          <span className={`w-2 h-2 rounded-full ${MCP_DOT[mcpStatus]}`} />
          MCP
        </span>
      )}
      {onThisDevice && onRevealProject && (
        <OnThisDeviceChip onShowProject={onRevealProject} reminder={backupReminder} icon popover={BESIDE} />
      )}
      {syncStatus && <SyncChip status={syncStatus} shared={syncShared} icon popover={BESIDE} />}
    </div>
  );
}
