/**
 * Where each box of a device's graph goes (INST-44): dagre lays it out left to right, signals and
 * params on the left, the output on the right. Each box's size comes from its rows, so a block with
 * many inputs gets the room for them; a param is a small tag.
 *
 * A chain (INST-44.2) lays each device out on its own, then sets the devices side by side in chain
 * order, centred on one line, each in a frame with a header; a folded device is one small box.
 */
import { graphlib, layout } from "@dagrejs/dagre";
import type { DeviceGraph, GraphNode } from "../../audio/definitions/graph";

/** A box's width, its title's height, and each port row's, in px: what `DeviceGraphView` draws. */
export const BOX_WIDTH = 200;
export const HEADER_HEIGHT = 40;
export const ROW_HEIGHT = 20;
/** A param's tag: its name over its range. */
export const PARAM_WIDTH = 150;
export const PARAM_HEIGHT = 34;

export const nodeSize = (node: GraphNode): { width: number; height: number } =>
  node.kind === "param"
    ? { width: PARAM_WIDTH, height: PARAM_HEIGHT }
    : {
        width: BOX_WIDTH,
        height: HEADER_HEIGHT + Math.max(node.inputs.length + node.outputs.length, 1) * ROW_HEIGHT + 8,
      };

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

/** Each box's top-left corner, by id, and the size of the whole, margins included. */
export function layoutGraph(graph: DeviceGraph): { positions: Map<string, Point>; width: number; height: number } {
  const layoutGraph = new graphlib.Graph();
  layoutGraph.setGraph({ rankdir: "LR", nodesep: 16, ranksep: 90, marginx: 20, marginy: 20 });
  layoutGraph.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((node) => layoutGraph.setNode(node.id, nodeSize(node)));
  graph.edges.forEach((edge) => layoutGraph.setEdge(edge.from, edge.to));
  layout(layoutGraph);
  // dagre places centres; React Flow takes corners.
  const positions = new Map(
    graph.nodes.map((node) => {
      const placed = layoutGraph.node(node.id);
      const { width, height } = nodeSize(node);
      return [node.id, { x: placed.x - width / 2, y: placed.y - height / 2 }];
    }),
  );
  const { width = 0, height = 0 } = layoutGraph.graph();
  return { positions, width, height };
}

/** A device frame's header, the gap between devices, and a folded device's box, in px. */
export const GROUP_HEADER = 36;
export const GROUP_GAP = 90;
export const FOLDED_SIZE = { width: 210, height: 64 };

/** A device in a chain, to lay out: its graph, unless it's folded or has none. */
export interface ChainItem {
  id: string;
  graph?: DeviceGraph;
}

/** Each device's frame (or folded box) in the chain, and its boxes' corners inside the frame. */
export function layoutChain(items: readonly ChainItem[]): {
  frames: Map<string, Rect>;
  inside: Map<string, Map<string, Point>>;
} {
  const laid = items.map((item) => {
    if (!item.graph) return { item, size: FOLDED_SIZE };
    const { positions, width, height } = layoutGraph(item.graph);
    return { item, positions, size: { width, height: height + GROUP_HEADER } };
  });
  // Side by side, each centred on the line y = 0.
  const lefts = laid.reduce<number[]>(
    (starts, _item, index) => [...starts, index === 0 ? 0 : starts[index - 1] + laid[index - 1].size.width + GROUP_GAP],
    [],
  );
  const frames = new Map(
    laid.map(({ item, size }, index): [string, Rect] => [item.id, { x: lefts[index], y: -size.height / 2, ...size }]),
  );
  const inside = new Map(
    laid.flatMap(({ item, positions }) =>
      positions
        ? [
            [
              item.id,
              new Map(
                [...positions].map(([id, point]): [string, Point] => [id, { x: point.x, y: point.y + GROUP_HEADER }]),
              ),
            ] as const,
          ]
        : [],
    ),
  );
  return { frames, inside };
}
