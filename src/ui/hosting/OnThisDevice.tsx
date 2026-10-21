/**
 * "On this device" (HOST-23.2.5): what a standalone run says about where its files are, calmly and
 * once in each place rather than as a warning. Standalone is a mode, not a fault, so it is grey like
 * an idle chip, never the warning colour the offline banner uses (that's for hosted but unreachable).
 *
 * The same details in two places: on desktop behind a chip where the sync chip sits, and on both
 * shells as a line at the top of Projects, where people look for their files. The storage steps
 * (HOST-23.2.1) add to the details: whether the browser may clear them, and backups.
 */
import { useEffect, useRef, useState } from "react";
import { hosting } from "../../hosting";
import { Popover } from "../Menu";
import { insideMenu } from "../insideMenu";

/** Whether this run keeps everything on the device, so the note and chip have something to say. */
export const onThisDevice = hosting.mode === "standalone";

const linkClass = "text-you underline underline-offset-2 hover:text-strong";

/** Where the files are, how to keep a copy, and what the online app adds. */
export function OnThisDeviceDetails() {
  const { interest, hostedApp } = hosting.links;
  return (
    <div className="flex flex-col gap-2 text-[12.5px] leading-snug text-ink">
      <p>Your projects, patches and favourites are saved in this browser, on this device.</p>
      <p className="text-muted">To keep a copy, export a project from its ⋮ menu in Projects.</p>
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

const Dot = () => <span aria-hidden="true" className="w-2 h-2 rounded-full bg-faint" />;

/** The desktop status bar's chip, in place of the sync chip: a click shows the details. */
export function OnThisDeviceChip() {
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
        <Dot />
        On this device
      </button>
      {open && (
        <Popover
          anchorRef={triggerRef}
          strategy="below"
          side="right"
          role="dialog"
          label="On this device"
          onDetached={() => setOpen(false)}
        >
          {() => (
            <div className="w-72 px-3.5 py-2.5">
              <OnThisDeviceDetails />
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

/** The line at the top of Projects, opening the details in place. */
export function OnThisDeviceNote() {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="On this device" className="mx-4 mb-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex items-center gap-2 min-h-9 pointer-coarse:min-h-11 text-[12.5px] text-muted hover:text-ink cursor-pointer"
      >
        <Dot />
        Saved on this device
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
        <div className="mt-1 rounded-lg border border-line bg-stage px-3.5 py-3">
          <OnThisDeviceDetails />
        </div>
      )}
    </section>
  );
}
