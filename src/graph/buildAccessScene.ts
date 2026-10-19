/**
 * Pure layout for the access graph.
 *
 * `buildAccessScene` converts the derived `AccessGraphData` (nodes + edges,
 * direction user → … → source) into positioned React Flow `Node`/`Edge`
 * objects. It runs a single dagre pass for coordinates — mirroring
 * `org-graph/src/graph/layout.ts` — and attaches the handle ids / positions the
 * custom node exposes, so the React Flow component never computes geometry.
 *
 * It is deliberately framework-pure: no React, no DOM, no I/O, no mutation of
 * the input graph, deterministic output. React Flow's `css: false` in the test
 * runner means this module (and its unit test) exercise all the graph logic
 * without mounting the canvas or needing jsdom measurement.
 */
import { Graph, layout } from '@dagrejs/dagre'
import { Position, type Edge, type Node } from '@xyflow/react'
import type { AccessGraphData, AccessSceneNodeData, RankDir } from '../sailpoint/types'

/** A positioned React Flow node whose `data` is our small scene payload. */
export type AccessSceneNode = Node<AccessSceneNodeData, 'access'>

/** The pure builder's output: positioned nodes + styled edges. */
export interface AccessScene {
  nodes: AccessSceneNode[]
  edges: Edge[]
}

/**
 * Fixed card box, shared with `AccessGraph.css`. Dagre lays out on these exact
 * dimensions and the node reads back the top-left corner, so the drawn card
 * matches the computed rank/row spacing.
 */
const NODE_WIDTH = 200
const NODE_HEIGHT = 64

/** Dagre spacing — roomy enough that the 200px cards never crowd a rank. */
const NODE_SEP = 48
const RANK_SEP = 120
const MARGIN = 24

/**
 * The handle ids + source/target positions for a given direction. Matches the
 * eight handles placed by `AccessNode` (top/bottom/left/right × in/out) so an
 * edge always attaches at the rank-facing edge of each card.
 */
function handles(direction: RankDir): {
  sourceHandle: string
  targetHandle: string
  sourcePosition: Position
  targetPosition: Position
} {
  if (direction === 'TB') {
    return {
      sourceHandle: 'bottom-out',
      targetHandle: 'top-in',
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }
  }
  return {
    sourceHandle: 'right-out',
    targetHandle: 'left-in',
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  }
}

/**
 * Builds a positioned scene from the derived graph. Empty graph → empty scene.
 * PURE and deterministic: identical input (same graph + rankdir) yields
 * identical output.
 */
export function buildAccessScene(
  graph: AccessGraphData,
  rankdir: RankDir,
): AccessScene {
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [] }
  }

  const handle = handles(rankdir)

  const dagreGraph = new Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({
    rankdir,
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    ranker: 'network-simplex',
    marginx: MARGIN,
    marginy: MARGIN,
  })

  for (const node of graph.nodes) {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of graph.edges) {
    dagreGraph.setEdge(edge.from, edge.to)
  }

  layout(dagreGraph)

  const nodes: AccessSceneNode[] = graph.nodes.map((node) => {
    const placed = dagreGraph.node(node.id)
    return {
      id: node.id,
      type: 'access',
      position: {
        x: placed.x - NODE_WIDTH / 2,
        y: placed.y - NODE_HEIGHT / 2,
      },
      data: { kind: node.kind, label: node.label },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      sourcePosition: handle.sourcePosition,
      targetPosition: handle.targetPosition,
      draggable: false,
      connectable: false,
    }
  })

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: `e:${edge.from}:${edge.to}`,
    source: edge.from,
    target: edge.to,
    sourceHandle: handle.sourceHandle,
    targetHandle: handle.targetHandle,
    // Weight an edge by how many matrix rows traverse it; label the busy ones.
    style: { strokeWidth: edge.pathCount > 1 ? 2.5 : 1.5 },
    label: edge.pathCount > 1 ? String(edge.pathCount) : undefined,
  }))

  return { nodes, edges }
}
