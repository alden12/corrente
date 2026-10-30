/**
 * One device in the rack (DAW-61.3): an instrument, an effect or a MIDI device, all drawn the same
 * way. A header in the device's colour (DAW-61.2) with its name, its kind, its bypass switch and its
 * actions; open, its body. Folding is view state (`deviceFolds.ts`), never an edit. An instrument or
 * effect on the engine has a button for its graph (INST-44), where there's somewhere to show it.
 *
 * On the desktop every device is one height (`DEVICE_HEIGHT`), folded or open, so a row of them lines
 * up. **Folded**, it's a narrow column, its name running down it (cut short with an ellipsis), as a
 * folded section's title does; stacked on a phone (`RackStacked`) it's a row across the screen. A device in a chain has a handle to drag it to another place in it
 * (`useChainDrag`).
 */
import { useContext, type ReactNode } from "react";
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
import { DEVICE_HEADER_HEIGHT, DEVICE_HEIGHT, RackStacked, SECTION_HEIGHT } from "./rackLayout";
import type { DeviceDrag } from "./useChainDrag";
import { GripIcon, PowerIcon } from "./deviceIcons";

const ICON_BUTTON =
  "flex items-center justify-center w-6 h-6 pointer-coarse:w-9 pointer-coarse:h-9 shrink-0 rounded text-muted hover:text-ink hover:bg-control cursor-pointer";

/** Where the drop mark sits for each side, across a row or down a stack. */
const DROP_MARKS = {
  row: { before: "top-0 bottom-0 -left-2 w-0.5", after: "top-0 bottom-0 -right-2 w-0.5" },
  stack: { before: "left-0 right-0 -top-2 h-0.5", after: "left-0 right-0 -bottom-2 h-0.5" },
} as const;

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
  remove,
  drag,
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
  /** Its bypass switch; an instrument has none. */
  bypass?: Bypass;
  /** Taking it out of its chain; an instrument is swapped, not removed. */
  remove?: { title: string; run: () => void };
  /** Dragging it to another place in its chain. */
  drag?: DeviceDrag;
  /** Its other header buttons (a library update). */
  actions?: ReactNode;
  /** Its params: how many it says folded, and whether it starts open (`startsOpen`). */
  schema: ParamSchema;
  /** What its graph is drawn as: an instrument, an effect or a MIDI device. */
  graph?: DeviceKind;
  children: ReactNode;
}) {
  const stacked = useContext(RackStacked);
  const folds = useDeviceFolds();
  const graphable = useCanViewGraph(graph && { kind: graph, type: device.type });
  const opensAtStart = startsOpen(label, schema);
  const open = folds.isOpen(foldKey, opensAtStart);
  const toggleFold = () => folds.toggle(foldKey, opensAtStart);
  // Folded on the desktop, the header runs down a column; anywhere else, across.
  const column = !open && !stacked;
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
      className={`relative scroll-mt-12 shrink-0 min-w-0 max-w-full border border-line rounded-xl bg-ground ${
        stacked ? "w-full" : ""
      } ${bypass?.bypassed ? "opacity-50" : ""} ${drag?.dragging ? "opacity-40" : ""}`}
      style={deviceEdge(device)}
    >
      {drag?.drop && (
        <span
          aria-hidden="true"
          className={`absolute rounded-full bg-you ${DROP_MARKS[stacked ? "stack" : "row"][drag.drop]}`}
        />
      )}
      <div
        className={`flex items-center gap-1.5 cursor-pointer ${
          column ? "flex-col px-1 py-1.5" : `pl-1 pr-2 ${stacked ? "py-1" : ""} ${open ? "border-b border-line" : ""}`
        }`}
        // Open on the desktop, the header is a set height, so its sections add up to the device's.
        style={stacked ? undefined : { height: column ? DEVICE_HEIGHT : DEVICE_HEADER_HEIGHT }}
        // A tap anywhere that is not a control folds it, as on the column's section headers.
        onClick={foldOnHeaderClick(toggleFold)}
        title={open ? undefined : `${label} · ${kind} · ${paramCount(schema.length)}`}
      >
        {drag && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Move ${label}`}
            title="Drag to move (or use the arrow keys)"
            {...drag.handle}
            className={`${ICON_BUTTON} touch-none cursor-grab active:cursor-grabbing`}
          >
            <GripIcon />
          </span>
        )}
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
          className={`min-w-0 min-h-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold text-strong ${
            column ? "flex-1" : ""
          }`}
          style={column ? { writingMode: "vertical-rl" } : undefined}
          title={open ? label : undefined}
        >
          {label}
        </span>
        {!column && <span className="font-mono text-[9px] tracking-wider uppercase text-faint shrink-0">{kind}</span>}
        <span className={`flex items-center gap-1 shrink-0 ${column ? "flex-col" : "ml-auto pl-2"}`}>
          {bypass && (
            <button
              type="button"
              aria-pressed={!bypass.bypassed}
              aria-label={`${bypass.bypassed ? "Enable" : "Bypass"} ${label}`}
              title={bypass.bypassed ? "Enable" : "Bypass"}
              onClick={bypass.onToggle}
              className={`${ICON_BUTTON} ${bypass.bypassed ? "text-faint" : "text-you hover:text-you"}`}
            >
              <PowerIcon />
            </button>
          )}
          {/* Its graph is for a device you're looking into, so only open. */}
          {open && graph && graphable && (
            <button
              type="button"
              title="View device graph"
              aria-label={`View ${label}'s graph`}
              onClick={() => openDeviceGraph(graph, device.type)}
              className={ICON_BUTTON}
            >
              <GraphIcon />
            </button>
          )}
          {actions}
          {remove && (
            <button
              type="button"
              title={remove.title}
              aria-label={`${remove.title}: ${label}`}
              onClick={remove.run}
              className={`${ICON_BUTTON} text-[16px] leading-none`}
            >
              ×
            </button>
          )}
        </span>
      </div>
      {open && (
        // At least a section's height, so a body of its own (the drum kit's pads) is never shorter.
        <div style={stacked ? undefined : { minHeight: SECTION_HEIGHT }}>
          <DeviceHue.Provider value={deviceHue(device)}>{children}</DeviceHue.Provider>
        </div>
      )}
    </div>
  );
}
