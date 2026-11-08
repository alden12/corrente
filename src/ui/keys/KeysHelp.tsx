/**
 * What the computer keyboard does beyond the keys themselves, behind an ⓘ in the Keys header: the
 * header had no room left once Tab sustain and the Mac's second lift joined Shift and the octave keys.
 * The list follows what the keys play now (a kit's pads, chords or notes), so it never names a key
 * that does nothing here.
 */
import { useCallback, useRef, useState } from "react";
import { Popover } from "../Menu";
import { useDismiss } from "../useDismiss";
import { isMac } from "./platform";
import type { KeyRowMode } from "./keyLayout";
import { keysHelpRows } from "./keysHelpRows";

export function KeysHelp({ kit, chords, rowMode }: { kit: boolean; chords: boolean; rowMode: KeyRowMode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, triggerRef);
  const rows = keysHelpRows({ kit, chords, rowMode, mac: isMac() });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((was) => !was)}
        className="w-6 h-6 shrink-0 flex items-center justify-center rounded-[5px] text-muted hover:text-ink hover:bg-control cursor-pointer"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          className="w-4 h-4"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v4" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.4" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <Popover
          anchorRef={triggerRef}
          strategy="below"
          side="left"
          role="dialog"
          label="Keyboard shortcuts"
          onDetached={close}
        >
          {() => (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3.5 py-2.5 text-[12.5px] leading-snug">
              {rows.map(([keys, does]) => (
                <div key={keys} className="contents">
                  <dt className="font-mono text-[11px] text-muted whitespace-nowrap">{keys}</dt>
                  <dd className="text-ink">{does}</dd>
                </div>
              ))}
            </dl>
          )}
        </Popover>
      )}
    </>
  );
}
