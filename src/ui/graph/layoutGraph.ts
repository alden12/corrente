/**
 * Where each box of a device's graph goes (INST-44): dagre lays it out left to right, signals and
 * params on the left, the output on the right. Each box's size comes from its rows, so a block with
 * many inputs gets the room for them.
 */
import { graphlib, layout } from "@dagrejs/dagre";
import type { DeviceGraph, GraphNode } from "../../audio/definitions/graph";

/** A box's width, its title's height, and each port row's, in px: what `DeviceGraphView` draws. */
export const BOX_WIDTH = 200;
export const HEADER_HEIGHT = 40;
export const ROW_HEIGHT = 20;

export const boxHeight = (node: GraphNode): number =>
  HEADER_HEIGHT + Math.max(node.inputs.length + node.outputs.length, 1) * ROW_HEIGHT + 8;

/** Each box's top-left corner, by id. */
export function layoutGraph(graph: DeviceGraph): Map<string, { x: number; y: number }> {
  const layoutGraph = new graphlib.Graph();
  layoutGraph.setGraph({ rankdir: "LR", nodesep: 24, ranksep: 90, marginx: 20, marginy: 20 });
  layoutGraph.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((node) => layoutGraph.setNode(node.id, { width: BOX_WIDTH, height: boxHeight(node) }));
  graph.edges.forEach((edge) => layoutGraph.setEdge(edge.from, edge.to));
  layout(layoutGraph);
  // dagre places centres; React Flow takes corners.
  return new Map(
    graph.nodes.map((node) => {
      const placed = layoutGraph.node(node.id);
      return [node.id, { x: placed.x - BOX_WIDTH / 2, y: placed.y - boxHeight(node) / 2 }];
    }),
  );
}
