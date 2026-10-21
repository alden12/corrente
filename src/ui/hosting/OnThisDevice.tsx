/**
 * "On this device" (HOST-23.2.5): what a standalone run says about where its files are, calmly and
 * once in each place rather than as a warning. Labelled "Saved in browser" rather than "on this
 * device", because the browser is the fragile part and the label should hint at it. Standalone is a
 * mode, not a fault, so it shows a place (a laptop icon) rather than a status dot, and never the
 * warning colour the offline banner uses (that's for hosted but unreachable).
 *
 * The same details in two places: on desktop behind a chip where the sync chip sits, and on both
 * shells as a line at the top of Projects, where people look for their files. The storage steps
 * (HOST-23.2.1) add to the details: whether the browser may clear them (`storageRisk`), and backups.
 * The risk is told in the details; only Safari's week, where the files will go, turns the icon amber.
 * When projects have changed enough since their last export (`backupReminder`), both read "Back up?"
 * and the details lead with which ones, each with its Export button: no banner, nothing that pops up.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { hosting } from "../../hosting";
import {
  installApp,
  readStorageRisk,
  subscribeStorageRisk,
  type StorageRisk,
  type StorageRiskSnapshot,
} from "../../hosting/storageRisk";
import { Popover } from "../Menu";
import { insideMenu } from "../insideMenu";
import { DeviceIcon } from "../shellIcons";
import { useNow } from "../timeAgo";
import type { EditLog } from "../../audio/commands/editLog";
import { notNow, reminderDue, setReminderOff, useOpenProjectChanges, useReminderState } from "./backupReminder";

/** Whether this run keeps everything on the device, so the note and chip have something to say. */
export const onThisDevice = hosting.mode === "standalone";

const linkClass = "text-you underline underline-offset-2 hover:text-strong";

/** The open source's home: the app's own repository, so nothing private. */
const SOURCE_URL = "https://github.com/alden12/corrente";

const useStorageRisk = (): StorageRiskSnapshot =>
  useSyncExternalStore(subscribeStorageRisk, readStorageRisk, readStorageRisk);

/** What the backup reminder needs: the open project's log, and a way to export it. */
export interface Reminder {
  editLog: EditLog;
  onExport: () => void;
}

/** The reminder's settings, the open project's changes, and whether it's showing now. */
function useBackupReminder(editLog?: EditLog) {
  const state = useReminderState();
  const changes = useOpenProjectChanges(editLog);
  return { state, changes, due: reminderDue(changes, state, useNow(60_000)) };
}

/** The chip's and the note's label: a question while the reminder is due, the place otherwise. */
const usePlaceLabel = (reminder?: Reminder) =>
  useBackupReminder(reminder?.editLog).due ? "Back up?" : "Saved in browser";

/** What the browser may do with the files, and the way out. */
const RISK: Record<StorageRisk, string> = {
  kept: "This browser has agreed to keep them; only clearing this site's data removes them.",
  "may-clear":
    "This browser may clear them if the device runs short of space. Installing Corrente asks it to keep them.",
  week: "Safari deletes them after 7 days without a visit. Add Corrente to your Dock (File menu) or Home Screen (Share menu) to keep them.",
};

/**
 * The laptop, amber only while Safari's week applies: the one case where the files will go unless
 * something is done, rather than might under storage pressure (Alden, 2026-10-21).
 */
function PlaceIcon({ large = false }: { large?: boolean }) {
  const { risk } = useStorageRisk();
  return <DeviceIcon className={`${large ? "w-5 h-5" : "w-4 h-4"} ${risk === "week" ? "text-warn" : ""}`} />;
}

/** The browser's storage answer, and an Install button where the browser offers one. */
function StorageLine() {
  const { risk, canInstall } = useStorageRisk();
  if (!risk) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      <p className={risk === "kept" ? "text-muted" : "text-ink"}>{RISK[risk]}</p>
      {canInstall && risk !== "kept" && (
        <button
          type="button"
          onClick={() => void installApp()}
          className="h-8 pointer-coarse:h-10 px-3 rounded-md border border-line bg-ground text-ink hover:border-you cursor-pointer"
        >
          Install Corrente
        </button>
      )}
    </div>
  );
}

/** The open project's changes since its last export, with Export, then Not now and Don't ask me again. */
function BackupReminder({ reminder }: { reminder?: Reminder }) {
  const { state, changes, due } = useBackupReminder(reminder?.editLog);
  if (!reminder) return null;
  if (state.off) {
    return (
      <p className="text-muted">
        Backup reminders are off.{" "}
        <button type="button" onClick={() => setReminderOff(false)} className={`${linkClass} cursor-pointer`}>
          Turn them on
        </button>
      </p>
    );
  }
  if (!due) return null;
  return (
    <section aria-label="Back up" className="flex flex-col gap-2 rounded-md border border-line bg-ground px-3 py-2.5">
      <p>
        This project has {changes.count} {changes.count === 1 ? "change" : "changes"} since you last exported it. An
        export is the copy that survives this browser.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={reminder.onExport} className={actionClass}>
          Export this project
        </button>
        <button type="button" onClick={() => notNow()} className={`${linkClass} cursor-pointer`}>
          Not now
        </button>
        <button type="button" onClick={() => setReminderOff(true)} className={`${linkClass} cursor-pointer`}>
          Don&apos;t ask me again
        </button>
      </div>
    </section>
  );
}

/**
 * Where the files are, how to keep a copy, what the online app adds, and where the source is. Also
 * the first-run intro (HOST-23.2.6, in the start card) and the Account settings page, so dismissing
 * the intro never hides where the files went.
 */
export function OnThisDeviceDetails({ onShowProject, reminder }: { onShowProject?: () => void; reminder?: Reminder }) {
  const { interest, hostedApp } = hosting.links;
  return (
    <div className="flex flex-col gap-2 text-[12.5px] leading-snug text-ink">
      <BackupReminder reminder={reminder} />
      <p>Your projects, patches and favourites are saved in this browser, on this device.</p>
      <StorageLine />
      <p className="text-muted">
        To keep a copy, export your project.{" "}
        {onShowProject && (
          <button type="button" onClick={onShowProject} className={`${linkClass} cursor-pointer`}>
            Export from the project page
          </button>
        )}
      </p>
      {(interest || hostedApp) && (
        <p className="text-muted">
          Corrente online adds sharing and live collaboration.{" "}
          {interest ? (
            <>
              It&apos;s in preview:{" "}
              <a href={interest} target="_blank" rel="noreferrer" className={linkClass}>
                register interest
              </a>
              .
            </>
          ) : (
            <a href={hostedApp} target="_blank" rel="noreferrer" className={linkClass}>
              Open Corrente online
            </a>
          )}
        </p>
      )}
      <p className="text-muted">
        Corrente is open source. Run it on your own computer and an AI agent such as Claude can play it with you:{" "}
        <a href={SOURCE_URL} target="_blank" rel="noreferrer" className={linkClass}>
          source on GitHub
        </a>
        .
      </p>
    </div>
  );
}

/** The desktop status bar's chip, in place of the sync chip: a click shows the details. */
/** `onShowProject` opens the open project's page, where its Export button is. */
/**
 * `icon` is the phone's top bar, where there's no room for words: the laptop alone, with a dot while
 * the reminder is due. It's there rather than only in Projects because a phone rarely visits Projects.
 */
export function OnThisDeviceChip({
  onShowProject,
  reminder,
  icon = false,
}: {
  onShowProject: () => void;
  reminder?: Reminder;
  icon?: boolean;
}) {
  const label = usePlaceLabel(reminder);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Closes on a click elsewhere or Escape, as the app's menus do.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!insideMenu(event.target) && !triggerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((was) => !was)}
        {...(icon
          ? {
              "aria-label": label,
              title: label,
              className:
                "relative shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-md text-muted hover:text-ink cursor-pointer",
            }
          : {
              className:
                "inline-flex items-center gap-1.5 h-6 px-1 font-mono text-[11px] text-muted hover:text-ink cursor-pointer",
            })}
      >
        <PlaceIcon large={icon} />
        {icon
          ? label === "Back up?" && (
              <span aria-hidden="true" className="absolute top-2 right-1.5 w-2 h-2 rounded-full bg-you" />
            )
          : label}
      </button>
      {open && (
        <Popover
          anchorRef={triggerRef}
          strategy="below"
          side="right"
          role="dialog"
          label="Saved in browser"
          onDetached={() => setOpen(false)}
        >
          {() => (
            <div className="w-72 px-3.5 py-2.5">
              <OnThisDeviceDetails
                reminder={reminder}
                onShowProject={() => {
                  setOpen(false);
                  onShowProject();
                }}
              />
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

/** Back up the library, or restore it, where Projects has the means to (HOST-23.2.1.2). */
export interface BackupActions {
  onBackUp: () => void;
  onRestore: () => void;
  /** What the last restore did, or why it couldn't: shown under the buttons that did it. */
  result?: { text: string; failed: boolean };
}

const actionClass =
  "h-8 pointer-coarse:h-10 px-3 rounded-md border border-line bg-ground text-[12.5px] text-ink hover:border-you cursor-pointer";

/** The line at the top of Projects, opening the details in place, with the library's backup beneath them. */
export function OnThisDeviceNote({ backup, reminder }: { backup?: BackupActions; reminder?: Reminder }) {
  const label = usePlaceLabel(reminder);
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Saved in browser" className="mx-4 mb-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex items-center gap-2 min-h-9 pointer-coarse:min-h-11 text-[12.5px] text-muted hover:text-ink cursor-pointer"
      >
        <PlaceIcon />
        {label}
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className={`w-4 h-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-3 rounded-lg border border-line bg-stage px-3.5 py-3">
          <OnThisDeviceDetails reminder={reminder} />
          {backup && (
            <div className="flex flex-col gap-2">
              <p className="text-[12.5px] leading-snug text-muted">
                A project keeps the sounds it uses. Your library (saved patches, custom devices and favourites) is kept
                apart from projects, so back it up here.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={backup.onBackUp} className={actionClass}>
                  Back up library
                </button>
                <button type="button" onClick={backup.onRestore} className={actionClass}>
                  Restore library…
                </button>
              </div>
              {backup.result && (
                <p
                  role="status"
                  className={`text-[12.5px] leading-snug ${backup.result.failed ? "text-hot" : "text-ink"}`}
                >
                  {backup.result.text}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
