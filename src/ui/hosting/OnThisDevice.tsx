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

/** Whether this run keeps everything on the device, so the note and chip have something to say. */
export const onThisDevice = hosting.mode === "standalone";

const linkClass = "text-you underline underline-offset-2 hover:text-strong";

const useStorageRisk = (): StorageRiskSnapshot =>
  useSyncExternalStore(subscribeStorageRisk, readStorageRisk, readStorageRisk);

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
function PlaceIcon() {
  const { risk } = useStorageRisk();
  return <DeviceIcon className={`w-4 h-4 ${risk === "week" ? "text-warn" : ""}`} />;
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

/** Where the files are, how to keep a copy, and what the online app adds. */
export function OnThisDeviceDetails({ onShowProject }: { onShowProject?: () => void }) {
  const { interest, hostedApp } = hosting.links;
  return (
    <div className="flex flex-col gap-2 text-[12.5px] leading-snug text-ink">
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
    </div>
  );
}

/** The desktop status bar's chip, in place of the sync chip: a click shows the details. */
/** `onShowProject` opens the open project's page, where its Export button is. */
export function OnThisDeviceChip({ onShowProject }: { onShowProject: () => void }) {
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
        className="inline-flex items-center gap-1.5 h-6 px-1 font-mono text-[11px] text-muted hover:text-ink cursor-pointer"
      >
        <PlaceIcon />
        Saved in browser
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
}

const actionClass =
  "h-8 pointer-coarse:h-10 px-3 rounded-md border border-line bg-ground text-[12.5px] text-ink hover:border-you cursor-pointer";

/** The line at the top of Projects, opening the details in place, with the library's backup beneath them. */
export function OnThisDeviceNote({ backup }: { backup?: BackupActions }) {
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
        Saved in browser
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
          <OnThisDeviceDetails />
          {backup && (
            <div className="flex flex-col gap-2">
              <p className="text-[12.5px] leading-snug text-muted">
                Your patches, custom devices and favourites are kept apart from projects: back them up here.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={backup.onBackUp} className={actionClass}>
                  Back up library
                </button>
                <button type="button" onClick={backup.onRestore} className={actionClass}>
                  Restore library…
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
