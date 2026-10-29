/**
 * One device in the rack (DAW-61.3): an instrument, an effect or a MIDI device, all drawn the same
 * way. A header in the device's colour (DAW-61.2) with its name, its kind, its on switch and its
 * actions; open, its body; folded, how many controls it holds in place of the body. Folding is
 * view state (`deviceFolds.ts`), never an edit. An instrument or effect on the engine has a button for
 * its graph (INST-44), where there are editor tabs to show it in.
 */
import type { ReactNode } from "react";
import { deviceHue, type DeviceColor } from "../../audio/deviceColors";
import { deviceEdge } from "../deviceColor";
import { DeviceHue } from "./deviceHue";
import { useDeviceFolds } from "./deviceFolds";
import { paramCount } from "./paramCount";
import { foldOnHeaderClick } from "../controls/foldOnHeaderClick";
import { openDeviceGraph, useCanViewGraph } from "../tabs/openGraph";

export interface Bypass {
  bypassed: boolean;
  onToggle: () => void;
}

export function DeviceBlock({
  device,
  label,
  kind,
  foldKey,
  bypass,
  actions,
  params,
  graph,
  children,
}: {
  /** Its catalog entry: the type and colour. */
  device: { type: string; color?: DeviceColor };
  label: string;
  /** What it is, in a word: "instr", "fx", "midi". */
  kind: string;
  /** What remembers it folded: the device's id in the project, unique on the page. */
  foldKey: string;
  /** Its on switch; an instrument has none. */
  bypass?: Bypass;
  /** Its other header buttons (move, remove). */
  actions?: ReactNode;
  /** How many params it has, which it says folded. */
  params: number;
  /** What its graph is drawn as, for an instrument or an effect. */
  graph?: "instrument" | "effect";
  children: ReactNode;
}) {
  const [folded, toggleFold] = useDeviceFolds();
  const graphable = useCanViewGraph(graph && device.type);
  const open = !folded.has(foldKey);
  return (
    // A group, not a section: a section with a name is a landmark, and a rack of them would crowd
    // the page's landmarks (and share names with Explore's panels).
    <div
      role="group"
      aria-label={label}
      data-open={open}
      // The devices' bar scrolls to a device by this, clear of the bar itself. No wider than the rack,
      // so a wide device wraps its sections rather than pushing the page sideways.
      data-device={foldKey}
      className={`scroll-mt-12 shrink-0 min-w-0 max-w-full border border-line rounded-xl bg-ground ${bypass?.bypassed ? "opacity-50" : ""}`}
      style={deviceEdge(device)}
    >
      <div
        className={`flex items-center gap-1.5 pl-1 pr-2.5 py-1 cursor-pointer ${open ? "border-b border-line" : ""}`}
        // A tap anywhere that is not a control folds it, as on the column's section headers.
        onClick={foldOnHeaderClick(() => toggleFold(foldKey))}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Fold" : "Unfold"} ${label}`}
          onClick={() => toggleFold(foldKey)}
          className="flex items-center justify-center w-7 h-7 pointer-coarse:w-10 pointer-coarse:h-10 shrink-0 text-[16px] pointer-coarse:text-[22px] leading-none text-muted hover:text-ink cursor-pointer"
        >
          <span aria-hidden="true" className={open ? "rotate-90" : ""}>
            ▸
          </span>
        </button>
        <span className="truncate text-[12px] font-semibold text-strong" title={label}>
          {label}
        </span>
        <span className="font-mono text-[9px] tracking-wider uppercase text-faint shrink-0">{kind}</span>
        {!open && <span className="font-mono text-[10.5px] text-muted shrink-0">{paramCount(params)}</span>}
        <span className="ml-auto pl-2 flex items-center gap-1.5 shrink-0">
          {bypass && (
            <button
              type="button"
              title={bypass.bypassed ? "Enable" : "Bypass"}
              onClick={bypass.onToggle}
              className={`font-mono text-[10px] h-5 px-1.5 rounded border cursor-pointer ${
                bypass.bypassed ? "border-line text-muted" : "border-you/45 text-you"
              }`}
            >
              {bypass.bypassed ? "Off" : "On"}
            </button>
          )}
          {graph && graphable && (
            <button
              type="button"
              title="View device graph"
              aria-label={`View ${label}'s graph`}
              onClick={() => openDeviceGraph(graph, device.type)}
              className="flex items-center justify-center w-6 h-6 rounded text-muted hover:text-ink hover:bg-control cursor-pointer"
            >
              <GraphIcon />
            </button>
          )}
          {actions}
        </span>
      </div>
      {open && <DeviceHue.Provider value={deviceHue(device)}>{children}</DeviceHue.Provider>}
    </div>
  );
}

/** Three boxes wired left to right: a device's graph. */
function GraphIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="4" height="4" rx="1" />
      <rect x="1.5" y="9.5" width="4" height="4" rx="1" />
      <rect x="10.5" y="6" width="4" height="4" rx="1" />
      <path d="M5.5 4.5h2.5v3.5h2.5M5.5 11.5h2.5V8" />
    </svg>
  );
}
