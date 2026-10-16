/**
 * A chevron that pages a sideways scroller back or on, for whoever has no sideways scroll (a mouse
 * wheel, no trackpad): Explore's shelves, and the workbench's clip and device chips. Turns
 * invisible at the end it can't go past, keeping its room so the row doesn't shift.
 */
export function PageArrow({
  label,
  flip,
  shown,
  onClick,
}: {
  label: string;
  flip?: boolean;
  shown: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={!shown}
      className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-ink hover:bg-control cursor-pointer disabled:opacity-0 disabled:pointer-events-none transition-opacity"
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        className={`w-4 h-4 ${flip ? "rotate-180" : ""}`}
      >
        <path d="M6 3l5 5-5 5" />
      </svg>
    </button>
  );
}
