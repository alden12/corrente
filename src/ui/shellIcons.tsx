/** Glyphs shared by the desktop and touch shells, so the same action looks the same in both. */

/** Undo / redo arrows (redo is the mirror image). */
export const UndoIcon = ({ flip = false }: { flip?: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`w-5 h-5 ${flip ? "scale-x-[-1]" : ""}`}
  >
    <path d="M3 7h6.5a3.25 3.25 0 0 1 0 6.5H6" />
    <path d="M5.5 4 2.5 7l3 3" />
  </svg>
);

/** Three joined dots: share a project. */
export function ShareIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-4.5 h-4.5"
    >
      <circle cx="4" cy="8" r="2" />
      <circle cx="12" cy="3.5" r="2" />
      <circle cx="12" cy="12.5" r="2" />
      <path d="M5.8 7 10.2 4.5M5.8 9l4.4 2.5" />
    </svg>
  );
}

/** An arrow down into a tray: export (download) a project. */
export function ExportIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4.5 h-4.5"
    >
      <path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7" />
      <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

/** A laptop: kept on this device, where the sync chip would show a connection (HOST-23.2.5). */
export function DeviceIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="3.5" width="10" height="7" rx="1" />
      <path d="M1.5 12.5h13" strokeLinecap="round" />
    </svg>
  );
}

/** A bin: delete things (the clips line's delete mode). */
export function BinIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
    >
      <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.75 8.5h6.5L12 4.5M6.75 7v3.5M9.25 7v3.5" />
    </svg>
  );
}

/** A keyboard: show or hide the keys (the touch shell's keys dock, MOBILE-24). */
export function KeyboardIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
    >
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <path d="M5 3.5v5M8 3.5v5M11 3.5v5M3.5 12.5v-4h9v4" />
    </svg>
  );
}

/**
 * A stack of key rows with a + or − at its corner: add or take away a row of pads (the keys'
 * size buttons), saying *what* grows where a bare + did not.
 */
export function KeyRowsIcon({ change }: { change: "add" | "remove" }) {
  return (
    <svg
      viewBox="0 0 20 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-6 h-5"
    >
      <rect x="1.5" y="2" width="11" height="4.5" rx="1" />
      <rect x="1.5" y="9.5" width="11" height="4.5" rx="1" />
      <path d="M5.25 2v2.5M8.75 2v2.5M5.25 9.5V12M8.75 9.5V12" />
      <path d={change === "add" ? "M14.5 8h4.5M16.75 5.75v4.5" : "M14.5 8h4.5"} strokeWidth="1.7" />
    </svg>
  );
}

/** A solid triangle pointing left or right: step something down or up (the keys' octave). */
export function StepIcon({ direction }: { direction: "down" | "up" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className="w-4 h-4">
      <path d={direction === "down" ? "M11 2.5 4 8l7 5.5z" : "M5 2.5 12 8l-7 5.5z"} />
    </svg>
  );
}
