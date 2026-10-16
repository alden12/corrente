/**
 * What folded keys would play in, as a folded roll shows its clip: the key, and whether they are
 * chords. Both the phone's keys dock and the desktop's keys panel show it in their header.
 */
import type { PadSettings } from "./padSettings";

export function KeysPreview({ settings }: { settings: PadSettings }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0 font-mono text-[11px] text-muted">
      <span className="truncate">{settings.keyLabel}</span>
      {settings.chords && <span className="shrink-0 px-1.5 rounded-full bg-control text-[10px] text-ink">chords</span>}
    </span>
  );
}
