/**
 * A device drawn as a graph, read-only (INST-44): what's in its definition, box by box, so you can see
 * how a sound is built. Or a whole chain (INST-44.2): a track's or a patch's MIDI devices, instrument
 * and effects, each in a frame that folds to one box, joined by the links notes and sound take
 * between them. Opened as an editor tab (DAW-89) on the desktop. Loaded on demand: React Flow is only
 * fetched when a graph is first opened.
 *
 * Blocks are boxes titled by their node's name, with the block they run beneath; a box marked "voice"
 * runs once per note, "stereo" once per channel. Signals (each voice's, the host's, the track's input,
 * a MIDI device's notes) are boxes on the left, params small tags beside them, wired in dashed; the
 * output is on the right. A number written on an input is what feeds it without a wire. A legend says
 * what each outline means.
 */
import "@xyflow/react/dist/style.css";
import { useMemo, useState, type CSSProperties } from "react";
import { Background, Controls, Panel, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { chainGroups, type ChainDevice, type ChainGroup } from "../../audio/definitions/chainGraph";
import type { GraphNode } from "../../audio/definitions/graph";
import { layoutChain, layoutGraph, type Point } from "./layoutGraph";
import { ACCENTS } from "./accents";
import { Box, DeviceFrame, ParamTag, type BoxNode, type DeviceNode } from "./graphNodes";

const NODE_TYPES = { box: Box, param: ParamTag, frame: DeviceFrame };

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

const WIRE = { stroke: "var(--color-muted)", strokeWidth: 1.25 };
/** A param's wire is dashed in its colour, so controls read apart from the signal path. */
const PARAM_WIRE = { stroke: "var(--color-agent)", strokeWidth: 1, strokeDasharray: "4 3" };
const CHAIN_LINK = { stroke: "var(--color-you)", strokeWidth: 2.5 };

function Legend({ chain }: { chain: boolean }) {
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
      {chain && (
        <p className="flex items-center gap-2">
          <span className="w-4 h-0.5 shrink-0 bg-you" />
          Chain, device to device
        </p>
      )}
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

/** Where a device sits in a chain: its frame's id, and whether a link comes in and goes out. */
interface Place {
  frame: string;
  linkedIn: boolean;
  linkedOut: boolean;
}

/** One device's boxes and wires, placed by `positions`; in a chain, inside its frame, ids under the frame's. */
function deviceElements(
  group: ChainGroup,
  positions: Map<string, Point>,
  place?: Place,
): { nodes: BoxNode[]; edges: Edge[] } {
  const graph = group.graph!;
  const prefix = place ? `${place.frame}/` : "";
  const params = new Set(graph.nodes.filter((node) => node.kind === "param").map((node) => node.id));
  return {
    nodes: graph.nodes.map(
      (node): BoxNode => ({
        id: prefix + node.id,
        type: node.kind === "param" ? "param" : "box",
        position: positions.get(node.id)!,
        data: {
          node,
          chainIn: !!place?.linkedIn && node.id === group.entry,
          chainOut: !!place?.linkedOut && node.id === group.exit,
        },
        ...(place ? { parentId: place.frame } : {}),
        draggable: true,
      }),
    ),
    edges: graph.edges.map(
      (edge, index): Edge => ({
        id: `${prefix}edge:${index}`,
        source: prefix + edge.from,
        sourceHandle: edge.fromPort,
        target: prefix + edge.to,
        targetHandle: edge.toPort,
        ...(edge.label ? { label: edge.label } : {}),
        style: params.has(edge.from) ? PARAM_WIRE : WIRE,
        labelStyle: { fill: "var(--color-ink)", fontSize: 10, fontFamily: "var(--font-mono)" },
        labelBgStyle: { fill: "var(--color-panel)" },
      }),
    ),
  };
}

/** A chain's frames, the devices' boxes inside the open ones, and the links from each device to the next. */
function chainElements(
  groups: ChainGroup[],
  folded: ReadonlySet<string>,
  fold: (id: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const places = groups.map(
    (_, index): Place => ({ frame: `device:${index}`, linkedIn: index > 0, linkedOut: index < groups.length - 1 }),
  );
  const open = groups.map((group, index) => !!group.graph && !folded.has(places[index].frame));
  const { frames, inside } = layoutChain(
    groups.map((group, index) => ({ id: places[index].frame, ...(open[index] ? { graph: group.graph } : {}) })),
  );
  // A link leaves a device by its exit and arrives by its entry, or by the frame when it's folded or has none.
  const ends = groups.map((group, index) => {
    const { frame } = places[index];
    return {
      entry: open[index] && group.entry ? `${frame}/${group.entry}` : frame,
      exit: open[index] && group.exit ? `${frame}/${group.exit}` : frame,
    };
  });
  const frameNodes = groups.map((group, index): DeviceNode => {
    const { frame, linkedIn, linkedOut } = places[index];
    return {
      id: frame,
      type: "frame",
      position: frames.get(frame)!,
      data: {
        group,
        frame: frames.get(frame)!,
        folded: !open[index],
        ...(group.graph ? { onFold: () => fold(frame) } : {}),
        chainIn: linkedIn && ends[index].entry === frame,
        chainOut: linkedOut && ends[index].exit === frame,
      },
      draggable: true,
    };
  });
  const inner = groups.flatMap((group, index) =>
    open[index] ? [deviceElements(group, inside.get(places[index].frame)!, places[index])] : [],
  );
  const links = ends.slice(1).map(
    (next, index): Edge => ({
      id: `link:${index}`,
      source: ends[index].exit,
      sourceHandle: "chain-out",
      target: next.entry,
      targetHandle: "chain-in",
      animated: true,
      style: CHAIN_LINK,
    }),
  );
  // Frames first: React Flow wants a parent before its children.
  return {
    nodes: [...frameNodes, ...inner.flatMap((each) => each.nodes)],
    edges: [...inner.flatMap((each) => each.edges), ...links],
  };
}

/** The graph of `devices`: one drawn bare, more as a chain of frames. */
export default function DeviceGraphView({ devices }: { devices: ChainDevice[] }) {
  // Redrawn when the chain itself changes (a device added, switched off), not on every render.
  const chainKey = JSON.stringify(devices);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the chain's contents
  const groups = useMemo(() => chainGroups(devices), [chainKey]);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const chain = groups.length > 1;
  const { nodes, edges } = useMemo((): { nodes: Node[]; edges: Edge[] } => {
    if (!chain) {
      const [only] = groups;
      return only?.graph ? deviceElements(only, layoutGraph(only.graph).positions) : { nodes: [], edges: [] };
    }
    const fold = (id: string) =>
      setFolded((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    return chainElements(groups, folded, fold);
  }, [groups, folded, chain]);

  if (nodes.length === 0) {
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
        minZoom={0.05}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--color-line)" gap={24} />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <p className="px-2.5 py-1.5 rounded-md border border-line bg-panel text-[11.5px] text-muted">
            Read-only for now: editing graphs is coming soon.
          </p>
        </Panel>
        <Panel position="top-right">
          <Legend chain={chain} />
        </Panel>
      </ReactFlow>
    </div>
  );
}
