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
