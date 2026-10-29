/**
 * What a graph (INST-44) draws its nodes as: a block, signal or output as a box with a row per port,
 * a param as a small tag, and in a chain (INST-44.2) each device as a frame round its boxes, or one
 * small box when folded. A device's entry and exit carry a chain handle on their headers, which the
 * links between devices join.
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { GraphNode } from "../../audio/definitions/graph";
import { ACCENTS } from "./accents";
import type { ChainGroup, DeviceKind } from "../../audio/definitions/chainGraph";
import { GROUP_HEADER, HEADER_HEIGHT, ROW_HEIGHT, nodeSize, type Rect } from "./layoutGraph";

/** A device's kind in a frame's header. */
const KIND_LABELS: Record<DeviceKind, string> = { midi: "MIDI", instrument: "instrument", effect: "effect" };

/** Where a port's row sits, from the box's top: outputs first, then inputs. */
const rowTop = (row: number) => HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2;

const HANDLE = "!w-2 !h-2 !min-w-0 !min-h-0 !border-0 !bg-muted";
const CHAIN_HANDLE = "!w-2.5 !h-2.5 !min-w-0 !min-h-0 !border-0 !bg-you";

/** The handles a chain's link joins: in on the left of a header, out on the right. */
function ChainHandles({ chainIn, chainOut, top }: { chainIn?: boolean; chainOut?: boolean; top: number }) {
  return (
    <>
      {chainIn && (
        <Handle type="target" position={Position.Left} id="chain-in" className={CHAIN_HANDLE} style={{ top }} />
      )}
      {chainOut && (
        <Handle type="source" position={Position.Right} id="chain-out" className={CHAIN_HANDLE} style={{ top }} />
      )}
    </>
  );
}

export type BoxNode = Node<{ node: GraphNode; chainIn?: boolean; chainOut?: boolean }, "box" | "param">;

/** A param: its name over its range, and the handle its wires leave from. */
export function ParamTag({ data: { node } }: NodeProps<BoxNode>) {
  return (
    <div
      className="flex flex-col justify-center rounded-full border bg-panel px-3"
      style={{ ...nodeSize(node), borderColor: ACCENTS.param }}
      title={node.subtitle ? `${node.title}: ${node.subtitle}` : node.title}
    >
      <p className="text-[11.5px] leading-tight font-medium text-strong truncate">{node.title}</p>
      {node.subtitle && <p className="font-mono text-[9.5px] leading-tight text-faint truncate">{node.subtitle}</p>}
      <Handle type="source" position={Position.Right} id="value" className={`${HANDLE} !bg-agent`} />
    </div>
  );
}

export function Box({ data: { node, chainIn, chainOut } }: NodeProps<BoxNode>) {
  return (
    <div
      className="rounded-lg border bg-panel text-ink shadow-sm"
      style={{ ...nodeSize(node), borderColor: ACCENTS[node.kind] }}
    >
      <div className="flex items-center gap-1.5 px-2.5 border-b border-line-soft" style={{ height: HEADER_HEIGHT }}>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-strong truncate">{node.title}</p>
          {node.subtitle && <p className="font-mono text-[10px] text-faint truncate">{node.subtitle}</p>}
        </div>
        {node.voice && <span className="font-mono text-[9px] uppercase tracking-wider text-you">voice</span>}
        {node.stereo && <span className="font-mono text-[9px] uppercase tracking-wider text-muted">stereo</span>}
      </div>
      <ChainHandles chainIn={chainIn} chainOut={chainOut} top={HEADER_HEIGHT / 2} />
      {node.outputs.map((port, row) => (
        <div key={`out:${port.name}`}>
          <p
            className="absolute right-2.5 font-mono text-[10.5px] text-muted text-right"
            style={{ top: rowTop(row) - ROW_HEIGHT / 2, lineHeight: `${ROW_HEIGHT}px` }}
          >
            {port.name}
          </p>
          <Handle
            type="source"
            position={Position.Right}
            id={port.name}
            className={HANDLE}
            style={{ top: rowTop(row) }}
          />
        </div>
      ))}
      {node.inputs.map((port, index) => {
        const row = node.outputs.length + index;
        return (
          <div key={`in:${port.name}`}>
            <p
              className="absolute left-2.5 right-2.5 font-mono text-[10.5px] text-ink truncate"
              style={{ top: rowTop(row) - ROW_HEIGHT / 2, lineHeight: `${ROW_HEIGHT}px` }}
              title={port.value ? `${port.name} = ${port.value}` : port.name}
            >
              {port.name}
              {port.value && <span className="text-faint"> = {port.value}</span>}
            </p>
            <Handle
              type="target"
              position={Position.Left}
              id={port.name}
              className={HANDLE}
              style={{ top: rowTop(row) }}
            />
          </div>
        );
      })}
    </div>
  );
}

export type DeviceNode = Node<
  { group: ChainGroup; frame: Rect; folded: boolean; onFold?: () => void; chainIn?: boolean; chainOut?: boolean },
  "frame"
>;

/** A device in a chain: a frame round its boxes with its name on top, or folded, just the header. */
export function DeviceFrame({ data: { group, frame, folded, onFold, chainIn, chainOut } }: NodeProps<DeviceNode>) {
  const blocks = group.graph?.nodes.filter((node) => node.kind === "block").length ?? 0;
  return (
    <div
      className={`rounded-xl border-[1.5px] ${folded ? "bg-panel" : "bg-frame/60"} ${group.bypassed ? "opacity-55 border-dashed" : ""}`}
      style={{ width: frame.width, height: frame.height, borderColor: "var(--color-line)" }}
    >
      <div className="flex items-center gap-2 px-3" style={{ height: folded ? frame.height : GROUP_HEADER }}>
        {onFold && (
          <button
            type="button"
            onClick={onFold}
            aria-label={folded ? `Open ${group.label}` : `Fold ${group.label}`}
            title={folded ? "Open" : "Fold"}
            className="nodrag w-6 h-6 shrink-0 flex items-center justify-center rounded text-[15px] leading-none text-muted hover:text-ink hover:bg-ground cursor-pointer"
          >
            {folded ? "▸" : "▾"}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-strong truncate">{group.label}</p>
          {folded && (
            <p className="font-mono text-[10px] text-faint truncate">
              {group.graph ? `${blocks} block${blocks === 1 ? "" : "s"}` : "no graph to draw"}
            </p>
          )}
        </div>
        {group.bypassed && <span className="font-mono text-[9px] uppercase tracking-wider text-faint">off</span>}
        <span className="font-mono text-[9px] uppercase tracking-wider text-faint">{KIND_LABELS[group.kind]}</span>
      </div>
      <ChainHandles chainIn={chainIn} chainOut={chainOut} top={(folded ? frame.height : GROUP_HEADER) / 2} />
    </div>
  );
}
