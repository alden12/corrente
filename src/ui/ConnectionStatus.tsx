/**
 * Sync-connection UI: a status chip, which a press opens into what the status means, and the project
 * loading veil. The chip is a projection of the transport's `WsStatus` (src/contract/client.ts),
 * settled so it doesn't strobe (`settledSyncStatus.ts`).
 *
 * Being offline used to have a banner too, above the app and then over it. Above, it pushed the whole
 * app down each time it came or went; over, it covered controls. So it is the chip's to say, the way
 * "Saved in browser" says where a standalone run's files are (HOST-16): on desktop where the chip
 * already sat, and on a phone as a cloud on the top bar. What it means is behind a press, tiered by
 * whether the project is shared: a solo project offline is benign (edits are saved locally and go up
 * on reconnect), while a shared one can meet a teammate's edits to the same thing.
 */
import { useCallback, useRef, useState } from "react";
import type { WsStatus } from "../contract/client";
import { Popover } from "./Menu";
import { useDismiss } from "./useDismiss";
import { CloudIcon } from "./shellIcons";

const DOT: Record<WsStatus, string> = {
  connecting: "bg-faint animate-pulse",
  online: "bg-good",
  offline: "bg-warn",
  idle: "bg-faint",
};

const LABEL: Record<WsStatus, string> = {
  connecting: "Connecting…",
  online: "Synced",
  offline: "Offline",
  idle: "Idle",
};

/** What each status means, said when the chip is pressed. */
const DETAIL: Record<WsStatus, string> = {
  connecting: "Connecting to Corrente online.",
  online: "Connected. Your edits are saved online as you make them.",
  offline:
    "Offline. Your edits are saved on this device and go up when the connection is back. Corrente keeps trying in the meantime.",
  idle: "Paused while you're away. It reconnects as soon as you're back.",
};

/** Said as well while a shared project is offline. */
const SHARED_OFFLINE = "This project is shared, so someone else's edits to the same things may conflict with yours.";

/**
 * The connection chip: a dot and a word in the desktop status bar, or (`icon`) a cloud on the phone's
 * top bar with a dot while offline. A press shows what the status means.
 */
export function SyncChip({
  status,
  shared = false,
  icon = false,
}: {
  status: WsStatus;
  /** The project has collaborators, so being offline can conflict. */
  shared?: boolean;
  icon?: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, triggerRef);
  const warn = status === "offline" && shared;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Sync: ${LABEL[status]}`}
        title={LABEL[status]}
        onClick={() => setOpen((was) => !was)}
        className={
          icon
            ? `relative shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-md hover:text-ink cursor-pointer ${warn ? "text-warn" : "text-muted"}`
            : "inline-flex items-center gap-1.5 h-6 px-1 font-mono text-[11px] text-muted hover:text-ink cursor-pointer"
        }
      >
        {icon ? (
          <>
            <CloudIcon className="w-5 h-5" />
            {status !== "online" && (
              <span aria-hidden="true" className={`absolute top-2 right-1.5 w-2 h-2 rounded-full ${DOT[status]}`} />
            )}
          </>
        ) : (
          <>
            <span className={`w-2 h-2 rounded-full ${DOT[status]}`} />
            {LABEL[status]}
          </>
        )}
      </button>
      {open && (
        <Popover
          anchorRef={triggerRef}
          strategy="below"
          side={icon ? "left" : "right"}
          role="dialog"
          label="Sync"
          onDetached={close}
        >
          {() => (
            <div className="w-72 px-3.5 py-2.5 flex flex-col gap-2 text-[12.5px] leading-snug text-ink">
              <p>{DETAIL[status]}</p>
              {warn && <p className="text-warn">{SHARED_OFFLINE}</p>}
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

/** A full-screen load veil shown until the project bundle is ready (fast from the local cache, or a
 *  round-trip to the server on a first open). Matches the StartDialog overlay treatment. */
export function LoadingOverlay(): React.ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-ground/90">
      <span
        className="w-8 h-8 rounded-full border-2 border-faint border-t-transparent animate-spin"
        aria-hidden="true"
      />
      <span className="font-mono text-[12px] text-muted">Loading project…</span>
    </div>
  );
}
