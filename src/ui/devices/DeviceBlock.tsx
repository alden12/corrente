/**
 * One device in the rack (DAW-61.3): an instrument, an effect or a MIDI device, all drawn the same
 * way. A header in the device's colour (DAW-61.2) with its name, its kind, its on switch and its
 * actions; open, its body; folded, a narrow column with its name running down it. Folding is
 * view state (`deviceFolds.ts`), never an edit. An instrument or effect on the engine has a button for
 * its graph (INST-44), where there's somewhere to show it.
 */
import type { ReactNode } from "react";
import { deviceHue, type DeviceColor } from "../../audio/deviceColors";
import { deviceEdge } from "../deviceColor";
import { DeviceHue } from "./deviceHue";
import { startsOpen, useDeviceFolds } from "./deviceFolds";
import type { ParamSchema } from "../../audio/params/types";
import { paramCount } from "./paramCount";
import { foldOnHeaderClick } from "../controls/foldOnHeaderClick";
import { openDeviceGraph, useCanViewGraph } from "../tabs/openGraph";
import { GraphIcon } from "../graph/GraphIcon";
import type { DeviceKind } from "../../audio/definitions/chainGraph";

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
  schema,
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
  /** Its params: how many it says folded, and whether it starts open (`startsOpen`). */
  schema: ParamSchema;
  /** What its graph is drawn as: an instrument, an effect or a MIDI device. */
  graph?: DeviceKind;
  children: ReactNode;
}) {
  const folds = useDeviceFolds();
  const graphable = useCanViewGraph(graph && { kind: graph, type: device.type });
  const opensAtStart = startsOpen(label, schema);
  const open = folds.isOpen(foldKey, opensAtStart);
  const toggleFold = () => folds.toggle(foldKey, opensAtStart);
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
      {/* Folded, the header turns down the device's side as a narrow column, its name running down
          it, as a folded section's title does: a folded device that kept its header across would take
          nearly the room it had open. */}
      <div
        className={`flex items-center gap-1.5 cursor-pointer ${
          open ? "pl-1 pr-2.5 py-1 border-b border-line" : "flex-col px-1 py-1.5"
        }`}
        // A tap anywhere that is not a control folds it, as on the column's section headers.
        onClick={foldOnHeaderClick(toggleFold)}
        title={open ? undefined : `${label} · ${kind} · ${paramCount(schema.length)}`}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Fold" : "Unfold"} ${label}`}
          onClick={toggleFold}
          className="flex items-center justify-center w-7 h-7 pointer-coarse:w-10 pointer-coarse:h-10 shrink-0 text-[16px] pointer-coarse:text-[22px] leading-none text-muted hover:text-ink cursor-pointer"
        >
          <span aria-hidden="true" className={open ? "rotate-90" : ""}>
            ▸
          </span>
        </button>
        <span
          className={`text-[12px] font-semibold text-strong ${open ? "truncate" : "whitespace-nowrap"}`}
          style={open ? undefined : { writingMode: "vertical-rl" }}
          title={open ? label : undefined}
        >
          {label}
        </span>
        {open && <span className="font-mono text-[9px] tracking-wider uppercase text-faint shrink-0">{kind}</span>}
        <span className={`flex items-center gap-1.5 shrink-0 ${open ? "ml-auto pl-2" : "flex-col pt-1"}`}>
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
          {/* Its graph is for a device you're looking into, so only open. */}
          {open && graph && graphable && (
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
