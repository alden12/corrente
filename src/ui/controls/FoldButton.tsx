/**
 * The ▸ that folds a section of the workbench column away and back (DAW-61.1): the clips, the
 * roll, the devices. Turned down while the section is open.
 */
export interface Fold {
  open: boolean;
  onToggle: () => void;
}

export function FoldButton({ fold, label }: { fold: Fold; label: string }) {
  return (
    <button
      type="button"
      aria-expanded={fold.open}
      aria-label={`${fold.open ? "Fold" : "Open"} the ${label}`}
      onClick={fold.onToggle}
      className="flex items-center justify-center w-7 h-7 shrink-0 text-[16px] leading-none text-muted hover:text-ink cursor-pointer"
    >
      <span aria-hidden="true" className={fold.open ? "rotate-90" : ""}>
        ▸
      </span>
    </button>
  );
}
