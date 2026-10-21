/**
 * Pure layout for the access graph.
 *
 * `buildAccessScene` converts the derived `AccessGraphData` (nodes + edges,
 * direction user → … → source) into positioned React Flow `Node`/`Edge`
 * objects. It runs a single dagre pass for coordinates — mirroring
 * `org-graph/src/graph/layout.ts` — and attaches the handle ids / positions the
 * custom node exposes, so the React Flow component never computes geometry.
 *
 * Two layouts share one node/edge mapping:
 *
 * - "lanes" (default): every kind is pinned to its own column (LR) / row (TB)
 *   so the derivation layers user → role → access profile → entitlement →
 *   source read left to right. Used while reference content is SHOWN.
 * - "single lane" (`singleLane: true`): for a graph that holds only the user and
 *   its first-level items (the output of `withoutReference`). There is no
 *   derivation to show, so kind lanes would only create long edges that run
 *   behind other cards; every item goes in ONE lane directly after the user.
 *
 * It is deliberately framework-pure: no React, no DOM, no I/O, no mutation of
 * the input graph, deterministic output. React Flow's `css: false` in the test
 * runner means this module (and its unit test) exercise all the graph logic
 * without mounting the canvas or needing jsdom measurement.
 */
import { Graph, layout } from '@dagrejs/dagre'
import { Position, type Edge, type Node } from '@xyflow/react'
import type {
  AccessGraphData,
  AccessGraphNodeKind,
  AccessSceneNodeData,
  RankDir,
} from '../sailpoint/types'
import { isReferenceNode, isStatusEdge } from './referenceFilter'

/**
 * The fixed layer order, user → source. Every node of a given kind is pinned to
 * the rank for its index here, so a kind always forms its own column (LR) or
 * row (TB) regardless of how many hops its path took to reach it (a direct
 * entitlement and a role→AP→entitlement both land in the entitlement rank).
 */
const KIND_ORDER: readonly AccessGraphNodeKind[] = [
  'user',
  'role',
  'accessProfile',
  'entitlement',
  'source',
]

/** Index of a kind in {@link KIND_ORDER} (its fixed rank). */
function kindRank(kind: AccessGraphNodeKind): number {
  const index = KIND_ORDER.indexOf(kind)
  // Unknown kinds (shouldn't happen) sort after the known layers.
  return index === -1 ? KIND_ORDER.length : index
}

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
export const NODE_WIDTH = 200
export const NODE_HEIGHT = 64

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

/** Layout options for {@link buildAccessScene}. */
export interface AccessSceneOptions {
  /**
   * Lay out every non-user node in ONE lane directly after the user, ordered by
   * kind (role, access profile, entitlement), then label, then id. Meant for a
   * graph that contains only the user and its first-level items (the output of
   * `withoutReference`); the builder does not filter. Default `false` (lanes).
   */
  singleLane?: boolean
}

/**
 * One node's coordinates: the rank-axis position (x for LR, y for TB) and the
 * de-overlapped cross-axis TOP-LEFT position (y for LR, x for TB).
 */
interface Placement {
  rank: number
  cross: number
}

/** Case-insensitive, locale-stable label comparison. */
function compareLabels(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase(), 'en')
}

/**
 * Single-lane placement: the user is band 0, every other node is band 1, spaced
 * at the lane stride and centered on the lane's cross-axis midpoint (cross 0),
 * exactly like a lanes-mode lane. No dagre pass: nothing here depends on edges.
 */
function singleLanePlacements(
  graph: AccessGraphData,
  bandStep: number,
  crossStride: number,
): Map<string, Placement> {
  const placements = new Map<string, Placement>()
  const place = (nodes: AccessGraphData['nodes'], band: number) => {
    const rank = MARGIN + band * bandStep
    const spanStart = -((nodes.length - 1) * crossStride) / 2
    nodes.forEach((node, index) => {
      placements.set(node.id, { rank, cross: spanStart + index * crossStride })
    })
  }
  place(
    graph.nodes.filter((node) => node.kind === 'user'),
    0,
  )
  const items = graph.nodes
    .filter((node) => node.kind !== 'user')
    .sort((a, b) => {
      const byKind = kindRank(a.kind) - kindRank(b.kind)
      if (byKind !== 0) return byKind
      const byLabel = compareLabels(a.label, b.label)
      if (byLabel !== 0) return byLabel
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  place(items, 1)
  return placements
}

/**
 * Lanes placement: one dagre pass for the cross-axis ORDER, then every kind is
 * pinned to its fixed band (a column in LR, a row in TB) and each lane is
 * de-overlapped at a fixed stride.
 */
function lanePlacements(
  graph: AccessGraphData,
  rankdir: RankDir,
  bandStep: number,
  crossStride: number,
): Map<string, Placement> {
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

  const vertical = rankdir === 'TB'
  // Pin the rank axis to the kind's fixed band so every kind forms its own
  // column (LR) or row (TB).
  const rankCoordFor = (kind: AccessGraphNodeKind): number =>
    MARGIN + kindRank(kind) * bandStep

  // Collapsing every rank-distance of one kind into a single lane means dagre's
  // cross-axis coordinates — assigned when those nodes sat on DIFFERENT dagre
  // ranks — can coincide, so two cards in the same lane would overlap (the bug
  // from pinning alone). De-overlap each lane: keep dagre's cross-axis ORDER
  // (preserves a sensible top-to-bottom / left-to-right arrangement and keeps
  // edges from tangling) but re-space the cards at a fixed stride so no two in a
  // lane can touch.
  // dagre's centered cross-axis coordinate per node (x for LR, y for TB).
  const dagreCross = (id: string): number => {
    const placed = dagreGraph.node(id)
    return vertical ? placed.x : placed.y
  }

  const placements = new Map<string, Placement>()
  const byKind = new Map<AccessGraphNodeKind, AccessGraphData['nodes']>()
  for (const node of graph.nodes) {
    const lane = byKind.get(node.kind) ?? []
    lane.push(node)
    byKind.set(node.kind, lane)
  }
  for (const [kind, lane] of byKind) {
    // Order within the lane by dagre's cross-axis position, tie-broken by id so
    // the layout stays deterministic.
    const ordered = [...lane].sort((a, b) => {
      const delta = dagreCross(a.id) - dagreCross(b.id)
      return delta !== 0 ? delta : a.id.localeCompare(b.id)
    })
    // Center the lane on the midpoint of dagre's own spread so lanes of
    // different sizes stay roughly aligned around a common axis.
    const spanStart = -((ordered.length - 1) * crossStride) / 2
    ordered.forEach((node, index) => {
      placements.set(node.id, {
        rank: rankCoordFor(kind),
        cross: spanStart + index * crossStride,
      })
    })
  }
  return placements
}

/**
 * Builds a positioned scene from the derived graph. Empty graph → empty scene.
 * PURE and deterministic: identical input (same graph + rankdir + options)
 * yields identical output.
 */
export function buildAccessScene(
  graph: AccessGraphData,
  rankdir: RankDir,
  options: AccessSceneOptions = {},
): AccessScene {
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [] }
  }

  const handle = handles(rankdir)

  // Rank axis: x for LR (cards stack along y within a column), y for TB (cards
  // sit side by side along x within a row). The cross-axis extent is the card
  // height (LR) or width (TB).
  const vertical = rankdir === 'TB'
  const bandStep = (vertical ? NODE_HEIGHT : NODE_WIDTH) + RANK_SEP
  const crossExtent = vertical ? NODE_WIDTH : NODE_HEIGHT
  const crossStride = crossExtent + NODE_SEP

  // Per-node coordinates from whichever layout was requested.
  const placements = options.singleLane
    ? singleLanePlacements(graph, bandStep, crossStride)
    : lanePlacements(graph, rankdir, bandStep, crossStride)

  const nodes: AccessSceneNode[] = graph.nodes.map((node) => {
    const { rank: rankCoord, cross } = placements.get(node.id) ?? { rank: MARGIN, cross: 0 }
    // Rank-axis from the node's band; cross-axis from the de-overlapped lane.
    const x = vertical ? cross : rankCoord
    const y = vertical ? rankCoord : cross
    return {
      id: node.id,
      type: 'access',
      position: { x, y },
      data: {
        kind: node.kind,
        label: node.label,
        detail: node.detail,
        reviewStatus: node.reviewStatus,
        reviewMixed: node.reviewMixed,
        // A non-user node without a status is reference-only: it is shown to
        // explain how access derives, but is not itself reviewed.
        reference: isReferenceNode(node),
      },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      sourcePosition: handle.sourcePosition,
      targetPosition: handle.targetPosition,
      draggable: false,
      connectable: false,
      // Cards sit above every edge layer (status edges use zIndex 1), so a
      // status line that passes behind another card never strikes through its
      // name. Edges still stack status-over-reference among themselves.
      zIndex: 2,
    }
  })

  // Plain built-in React Flow edges (no custom edge type). The user→access-item
  // edge conveys review status via stroke color + dash across FOUR states:
  //   needsReview → dashed amber (--vc-warn),
  //   approved    → solid green (--vc-allow),
  //   revoked     → solid red (--vc-deny),
  //   reassigned  → dotted blue (--vc-accent, terminal).
  // approved vs revoked differ by COLOR only on this thin edge; the node's
  // corner icon carries the non-color SHAPE distinction (check vs X). The node
  // also carries the shape/text signal for every state. Deeper hops are
  // reference-only hairlines (muted, solid, below the status edges). The count badge was removed with the drill-down rework, so
  // `pathCount` no longer drives any rendering here. The switch is exhaustive
  // over the four-state union (a missing case is a type error).
  const edgeStyle = (
    status: NonNullable<(typeof graph.edges)[number]['reviewStatus']>,
  ): Edge['style'] => {
    switch (status) {
      case 'needsReview':
        return { stroke: 'var(--vc-warn)', strokeWidth: 2, strokeDasharray: '6 4' }
      case 'approved':
        return { stroke: 'var(--vc-allow)', strokeWidth: 2 }
      case 'revoked':
        return { stroke: 'var(--vc-deny)', strokeWidth: 2 }
      case 'reassigned':
        return { stroke: 'var(--vc-accent)', strokeWidth: 2, strokeDasharray: '2 3' }
    }
  }
  const edges: Edge[] = graph.edges.map((edge) => {
    const base: Edge = {
      id: `e:${edge.from}:${edge.to}`,
      source: edge.from,
      target: edge.to,
      sourceHandle: handle.sourceHandle,
      targetHandle: handle.targetHandle,
    }
    // Status edge: the user's first-level hop, drawn above reference edges.
    if (isStatusEdge(edge) && edge.reviewStatus) {
      return {
        ...base,
        className: `vc-graph-edge-status vc-graph-edge-${edge.reviewStatus}`,
        data: { reviewStatus: edge.reviewStatus, reviewMixed: edge.reviewMixed },
        style: edgeStyle(edge.reviewStatus),
        zIndex: 1,
      }
    }
    // Reference edge: every other hop, a thin muted neutral hairline.
    return {
      ...base,
      className: 'vc-graph-edge-reference',
      data: { reference: true },
      style: { stroke: 'var(--edge)', strokeWidth: 1, opacity: 0.45 },
      zIndex: 0,
    }
  })
  return { nodes, edges }
}
