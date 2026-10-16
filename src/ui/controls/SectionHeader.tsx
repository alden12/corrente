/**
 * The header every section of the workbench column wears (DAW-61.1): clips, roll, keys, devices.
 * One height, one ground, one fold and one kind of title, so the column reads as a stack of like
 * things rather than four panels each drawn its own way. What a section adds goes in the middle
 * (`children`: the clip chips, the roll's tools) or at the right (`actions`), which never scroll.
 */
import type { ReactNode } from "react";
import { FoldButton, type Fold } from "./FoldButton";

/** Every section header's height, which layouts that size themselves around one (the keys) read. */
export const SECTION_HEADER_HEIGHT = 36;
/**
 * The same on touch, tall enough for a finger (MOBILE-24). The touch shell sets it as
 * `--section-header` on its root, so the headers inside follow without a prop each.
 */
export const TOUCH_SECTION_HEADER_HEIGHT = 44;

export function SectionHeader({
  title,
  fold,
  children,
  actions,
  className = "",
}: {
  title: string;
  /** The section's fold; a section that doesn't fold leaves the arrow's room empty, to line up. */
  fold?: Fold;
  /** Between the title and the actions; takes the room left and clips what doesn't fit. */
  children?: ReactNode;
  /** At the right, always in view. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`shrink-0 flex items-center gap-2 pl-1 pr-2.5 border-b border-line bg-panel ${className}`}
      style={{ height: `var(--section-header, ${SECTION_HEADER_HEIGHT}px)` }}
    >
      {fold ? <FoldButton fold={fold} label={title.toLowerCase()} /> : <span className="w-7 shrink-0" />}
      <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint shrink-0">{title}</span>
      <div className="flex-1 min-w-0 flex items-center gap-2">{children}</div>
      {actions && <div className="shrink-0 flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}
