/**
 * A device drawn as a graph, read-only (INST-44): what's in its definition, box by box, so you can see
 * how a sound is built. Opened as an editor tab (DAW-89) on the desktop. Loaded on demand: React Flow
 * is only fetched when a graph is first opened.
 *
 * Blocks are boxes titled by their node's name, with the block they run beneath; a box marked "voice"
 * runs once per note, "stereo" once per channel. Signals (each voice's, the host's, the track's input)
 * and, if asked for, params are boxes on the left; the output on the right. A number or a param
 * written on an input is what feeds it without a wire.
 */
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { engineDevice } from "../../audio/definitions/engineDevices";
import { deviceGraph, type GraphNode } from "../../audio/definitions/graph";
import { BOX_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, boxHeight, layoutGraph } from "./layoutGraph";

/** Each kind of box's accent, as a token: blocks plain, sources and the output marked. */
const ACCENTS: Record<GraphNode["kind"], string> = {
  block: "var(--color-line)",
  param: "var(--color-agent)",
  signal: "var(--color-you)",
  output: "var(--color-hot)",
};

/** Where a port's row sits, from the box's top: outputs first, then inputs. */
const rowTop = (row: number) => HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2;

type BoxNode = Node<{ node: GraphNode }, "box">;

function Box({ data: { node } }: NodeProps<BoxNode>) {
  const handle = "!w-2 !h-2 !min-w-0 !min-h-0 !border-0 !bg-muted";
  return (
    <div
      className="rounded-lg border bg-panel text-ink shadow-sm"
      style={{ width: BOX_WIDTH, height: boxHeight(node), borderColor: ACCENTS[node.kind] }}
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

const NODE_TYPES = { box: Box };

export default function DeviceGraphView({ type }: { type: string }) {
  const [paramBoxes, setParamBoxes] = useState(false);
  const spec = engineDevice(type);
  const { nodes, edges } = useMemo(() => {
    if (!spec) return { nodes: [], edges: [] };
    const graph = deviceGraph(spec.authored, spec.schema, { paramBoxes });
    const placed = layoutGraph(graph);
    return {
      nodes: graph.nodes.map(
        (node): BoxNode => ({
          id: node.id,
          type: "box",
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
          style: { stroke: "var(--color-muted)", strokeWidth: 1.25 },
          labelStyle: { fill: "var(--color-ink)", fontSize: 10, fontFamily: "var(--font-mono)" },
          labelBgStyle: { fill: "var(--color-panel)" },
        }),
      ),
    };
  }, [spec, paramBoxes]);

  if (!spec) {
    return (
      <p className="flex-1 flex items-center justify-center text-sm text-muted">This device has no graph to show.</p>
    );
  }
  return (
    <div className="relative flex-1 min-h-0 bg-ground">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        // Fitted, but no smaller than can be read: a big instrument opens on its start, to pan along.
        fitView
        fitViewOptions={{ minZoom: 0.6, maxZoom: 1 }}
        minZoom={0.1}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--color-line)" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <label className="absolute top-3 right-3 flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-line bg-panel text-[12px] text-ink cursor-pointer">
        <input type="checkbox" checked={paramBoxes} onChange={(event) => setParamBoxes(event.target.checked)} />
        Params as boxes
      </label>
    </div>
  );
}
