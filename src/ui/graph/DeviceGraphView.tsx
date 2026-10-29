/**
 * A device drawn as a graph, read-only (INST-44): what's in its definition, box by box, so you can see
 * how a sound is built. Opened as an editor tab (DAW-89) on the desktop. Loaded on demand: React Flow
 * is only fetched when a graph is first opened.
 *
 * Blocks are boxes titled by their node's name, with the block they run beneath; a box marked "voice"
 * runs once per note, "stereo" once per channel. Signals (each voice's, the host's, the track's input)
 * are boxes on the left, params small tags beside them, wired in dashed; the output is on the right. A
 * number written on an input is what feeds it without a wire. A legend says what each outline means.
 */
import "@xyflow/react/dist/style.css";
import { useMemo, type CSSProperties } from "react";
import {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { engineDevice } from "../../audio/definitions/engineDevices";
import { deviceGraph, type GraphNode } from "../../audio/definitions/graph";
import { HEADER_HEIGHT, ROW_HEIGHT, layoutGraph, nodeSize } from "./layoutGraph";

/** Each kind of box's accent, as a token: blocks plain, sources and the output marked. */
const ACCENTS: Record<GraphNode["kind"], string> = {
  block: "var(--color-line)",
  param: "var(--color-agent)",
  signal: "var(--color-you)",
  output: "var(--color-hot)",
};

/** The legend's words for each outline, in the order the graph reads. */
const LEGEND: { kind: GraphNode["kind"]; label: string }[] = [
  { kind: "param", label: "Param, a control you set" },
  { kind: "signal", label: "Signal coming in" },
  { kind: "block", label: "Block" },
  { kind: "output", label: "Output" },
];

/** React Flow's own controls and labels, on the app's tokens so they follow the theme. */
const THEMED = {
  "--xy-controls-button-background-color": "var(--color-panel)",
  "--xy-controls-button-background-color-hover": "var(--color-ground)",
  "--xy-controls-button-color": "var(--color-ink)",
  "--xy-controls-button-color-hover": "var(--color-strong)",
  "--xy-controls-button-border-color": "var(--color-line)",
  "--xy-controls-box-shadow": "none",
} as CSSProperties;

/** Where a port's row sits, from the box's top: outputs first, then inputs. */
const rowTop = (row: number) => HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2;

type BoxNode = Node<{ node: GraphNode }, "box" | "param">;

const HANDLE = "!w-2 !h-2 !min-w-0 !min-h-0 !border-0 !bg-muted";

/** A param: its name over its range, and the handle its wires leave from. */
function ParamTag({ data: { node } }: NodeProps<BoxNode>) {
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

function Box({ data: { node } }: NodeProps<BoxNode>) {
  const handle = HANDLE;
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
            className={handle}
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
              className={handle}
              style={{ top: rowTop(row) }}
            />
          </div>
        );
      })}
    </div>
  );
}

const NODE_TYPES = { box: Box, param: ParamTag };

function Legend() {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-md border border-line bg-panel text-[11.5px] text-ink">
      {LEGEND.map(({ kind, label }) => (
        <p key={kind} className="flex items-center gap-2">
          <span
            className={`w-4 h-3 shrink-0 border-[1.5px] ${kind === "param" ? "rounded-full" : "rounded-sm"}`}
            style={{ borderColor: ACCENTS[kind] }}
          />
          {label}
        </p>
      ))}
      <p className="flex items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-wider text-you">voice</span>
        runs once per note
      </p>
      <p className="flex items-center gap-2">
        <span className="font-mono text-[9px] uppercase tracking-wider text-muted">stereo</span>
        once per channel
      </p>
    </div>
  );
}

export default function DeviceGraphView({ type }: { type: string }) {
  const spec = engineDevice(type);
  const { nodes, edges } = useMemo(() => {
    if (!spec) return { nodes: [], edges: [] };
    const graph = deviceGraph(spec.authored, spec.schema);
    const placed = layoutGraph(graph);
    const params = new Set(graph.nodes.filter((node) => node.kind === "param").map((node) => node.id));
    return {
      nodes: graph.nodes.map(
        (node): BoxNode => ({
          id: node.id,
          type: node.kind === "param" ? "param" : "box",
          position: placed.get(node.id)!,
          data: { node },
          draggable: true,
        }),
      ),
      edges: graph.edges.map(
        (edge, index): Edge => ({
          id: `edge:${index}`,
          source: edge.from,
          sourceHandle: edge.fromPort,
          target: edge.to,
          targetHandle: edge.toPort,
          ...(edge.label ? { label: edge.label } : {}),
          // A param's wire is dashed in its colour, so controls read apart from the signal path.
          style: params.has(edge.from)
            ? { stroke: "var(--color-agent)", strokeWidth: 1, strokeDasharray: "4 3" }
            : { stroke: "var(--color-muted)", strokeWidth: 1.25 },
          labelStyle: { fill: "var(--color-ink)", fontSize: 10, fontFamily: "var(--font-mono)" },
          labelBgStyle: { fill: "var(--color-panel)" },
        }),
      ),
    };
  }, [spec]);

  if (!spec) {
    return (
      <p className="flex-1 flex items-center justify-center text-sm text-muted">This device has no graph to show.</p>
    );
  }
  return (
    <div className="relative flex-1 min-h-0 bg-ground" style={THEMED}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        // The whole graph fitted on opening, never zoomed in past its own size.
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.05 }}
        minZoom={0.1}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--color-line)" gap={24} />
        <Controls showInteractive={false} />
        <Panel position="top-right">
          <Legend />
        </Panel>
      </ReactFlow>
    </div>
  );
}
