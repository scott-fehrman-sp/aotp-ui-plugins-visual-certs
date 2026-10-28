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
 *   so the layers user → role → access profile → entitlement → attribute →
 *   source read left to right. The attribute lane is omitted when the graph
 *   has no attribute nodes, so a source stays beside its entitlements until
 *   an attribute is there to show. The canvas uses this whether reference
 *   content is shown or hidden: with reference hidden the nested lineage and
 *   the sources are simply absent, and the first-level items keep their role /
 *   access profile / entitlement lanes.
 *   A lane that holds MORE than `MAX_ITEMS_PER_LANE` (10) role / access profile
 *   / entitlement / attribute cards wraps into `ceil(n / 10)` balanced sub-columns (LR) or
 *   sub-rows (TB), placed side by side along the rank axis `WRAP_GAP` apart.
 *   Later lanes shift by the extra width; absent lanes keep their slot. The user
 *   and source lanes never wrap.
 * - "single lane" (`singleLane: true`): for a graph that holds only the user and
 *   its first-level items (the output of `withoutReference`); every item goes in
 *   ONE lane directly after the user, so no status edge can run behind another
 *   card. NOT used by the canvas at the moment (the product wants a dedicated
 *   lane per access type even with reference hidden); kept, pure and tested, as
 *   an option for a compact view.
 *
 * It is deliberately framework-pure: no React, no DOM, no I/O, no mutation of
 * the input graph, deterministic output. React Flow's `css: false` in the test
 * runner means this module (and its unit test) exercise all the graph logic
 * without mounting the canvas or needing jsdom measurement.
 */
import { Position, type Edge, type Node } from '@xyflow/react'
import type {
  AccessGraphData,
  AccessGraphNodeKind,
  AccessSceneNodeData,
  RankDir,
  UserCompletion,
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
  'attribute',
  'source',
]

/**
 * Index of a kind in the layer order. The attribute lane is dropped when the
 * graph has no attribute nodes, so source keeps the rank it had before that
 * lane existed. Other absent kinds still keep their slot.
 */
function kindRank(kind: AccessGraphNodeKind, attributeLane: boolean): number {
  const order = attributeLane
    ? KIND_ORDER
    : KIND_ORDER.filter((layer) => layer !== 'attribute')
  const index = order.indexOf(kind)
  // Unknown kinds (shouldn't happen) sort after the known layers.
  return index === -1 ? order.length : index
}

function hasAttributeLane(graph: AccessGraphData): boolean {
  return graph.nodes.some((node) => node.kind === 'attribute')
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
/**
 * The user node is taller than the others so its card can show the identity
 * lines an operator needs before choosing who to review: name, title,
 * department, location, and country, plus the completion row along the bottom.
 * Only the user kind uses this height; every other kind stays
 * {@link NODE_HEIGHT}. The user always sits alone in its own rank, so the
 * extra height only affects that lane's own cross-axis spacing, never the
 * other lanes.
 */
export const NODE_USER_HEIGHT = 160

/** The laid-out box height for a node of the given kind. */
export function nodeHeightFor(kind: AccessGraphNodeKind): number {
  return kind === 'user' ? NODE_USER_HEIGHT : NODE_HEIGHT
}

/**
 * Stacking order of every card. Status edges sit at 1 and reference edges at 0,
 * below the cards; `emphasizeEdges` raises a hovered item's edge above this.
 */
export const CARD_Z_INDEX = 2

/** Dagre spacing — roomy enough that the 200px cards never crowd a rank. */
const NODE_SEP = 48
const RANK_SEP = 120
const MARGIN = 24

/**
 * A role / access profile / entitlement lane holding MORE than this many cards
 * wraps into several sub-columns (LR) / sub-rows (TB). 10 or fewer is laid out
 * as a single column / row, exactly as before.
 */
export const MAX_ITEMS_PER_LANE = 10

/**
 * Rank-axis gap between the sub-columns / sub-rows of ONE wrapped lane. Smaller
 * than `RANK_SEP` so a wrapped type reads as one group, clearly closer than the
 * next type.
 */
export const WRAP_GAP = 40

/**
 * The lanes that wrap. The user lane is always one card and the source lane is
 * not an access item type (a long source lane stays one column / row).
 */
const WRAPPING_KINDS: ReadonlySet<AccessGraphNodeKind> = new Set([
  'role',
  'accessProfile',
  'entitlement',
  'attribute',
])

/**
 * Splits an ordered lane into balanced chunks of at most `MAX_ITEMS_PER_LANE`:
 * `k = ceil(n / 10)` chunks, the first `n % k` of size `floor(n / k) + 1` and
 * the rest `floor(n / k)` (11 -> 6+5, 25 -> 9+8+8, 31 -> 8+8+8+7). Order is
 * preserved (chunks read first to last reproduce the input). 10 or fewer items
 * (including none) come back as a single chunk. Pure; the input is not mutated.
 */
export function splitLane<T>(ordered: readonly T[]): T[][] {
  const n = ordered.length
  if (n <= MAX_ITEMS_PER_LANE) return [[...ordered]]
  const k = Math.ceil(n / MAX_ITEMS_PER_LANE)
  const base = Math.floor(n / k)
  const larger = n % k
  const chunks: T[][] = []
  let start = 0
  for (let i = 0; i < k; i++) {
    const size = i < larger ? base + 1 : base
    chunks.push(ordered.slice(start, start + size))
    start += size
  }
  return chunks
}

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
  /**
   * Review progress of the drilled-in user (percent, completed count, total).
   * Stamped onto the user node only. The canvas computes this from the
   * UNFILTERED subgraph, because the graph passed here may already have
   * completed items removed. Omitted leaves the user card without it.
   */
  completion?: UserCompletion
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
  const attributeLane = hasAttributeLane(graph)
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
      const byKind = kindRank(a.kind, attributeLane) - kindRank(b.kind, attributeLane)
      if (byKind !== 0) return byKind
      const byLabel = compareLabels(a.label, b.label)
      if (byLabel !== 0) return byLabel
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  place(items, 1)
  return placements
}

/**
 * Lanes placement: every kind is pinned to its fixed band (a column in LR, a
 * row in TB) and each lane is laid out independently — its cards ordered
 * alphabetically by display name and de-overlapped at a fixed stride. A role /
 * access profile / entitlement / attribute lane with more than `MAX_ITEMS_PER_LANE` cards
 * is split (column-major, in that same name order) into balanced sub-columns /
 * sub-rows `subStep` apart on the rank axis, each centered on cross 0. Lanes
 * are visited in layer order and every lane after a wrapped one shifts by the
 * extra width, accumulated; an absent kind keeps its fixed slot (lanes are not
 * compacted).
 */
function lanePlacements(
  graph: AccessGraphData,
  bandStep: number,
  crossStride: number,
  subStep: number,
): Map<string, Placement> {
  // Pin the rank axis to the kind's fixed band so every kind forms its own
  // column (LR) or row (TB).
  const attributeLane = hasAttributeLane(graph)
  const rankCoordFor = (kind: AccessGraphNodeKind): number =>
    MARGIN + kindRank(kind, attributeLane) * bandStep

  // Each lane is laid out independently: cards are ordered alphabetically by
  // display name (see below) and re-spaced at a fixed cross-axis stride so no
  // two in a lane can touch. No dagre pass is needed — the rank axis is pinned
  // to the kind's band and the cross-axis order is purely the name sort.
  const placements = new Map<string, Placement>()
  const byKind = new Map<AccessGraphNodeKind, AccessGraphData['nodes']>()
  for (const node of graph.nodes) {
    const lane = byKind.get(node.kind) ?? []
    lane.push(node)
    byKind.set(node.kind, lane)
  }
  const kinds = [...byKind.keys()].sort(
    (a, b) => kindRank(a, attributeLane) - kindRank(b, attributeLane),
  )
  // Extra rank-axis width taken by the wrapped lanes visited so far.
  let shift = 0
  for (const kind of kinds) {
    const lane = byKind.get(kind) ?? []
    // Order within the lane alphabetically by the card's display name so every
    // access-item lane (role / access profile / entitlement) and the source
    // lane read A→Z. Tie-broken by id so the layout stays deterministic. (The
    // user lane holds a single card, so the key is moot there.)
    const ordered = [...lane].sort((a, b) => {
      const byLabel = compareLabels(a.label, b.label)
      return byLabel !== 0 ? byLabel : a.id.localeCompare(b.id)
    })
    const chunks = WRAPPING_KINDS.has(kind) ? splitLane(ordered) : [ordered]
    const baseRank = rankCoordFor(kind) + shift
    chunks.forEach((chunk, chunkIndex) => {
      // Center each (sub-)lane on the midpoint of dagre's own spread so lanes of
      // different sizes stay roughly aligned around a common axis.
      const spanStart = -((chunk.length - 1) * crossStride) / 2
      chunk.forEach((node, index) => {
        placements.set(node.id, {
          rank: baseRank + chunkIndex * subStep,
          cross: spanStart + index * crossStride,
        })
      })
    })
    shift += (chunks.length - 1) * subStep
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
  // Rank-axis step between the sub-columns / sub-rows of one wrapped lane.
  const subStep = (vertical ? NODE_HEIGHT : NODE_WIDTH) + WRAP_GAP

  // Per-node coordinates from whichever layout was requested.
  const placements = options.singleLane
    ? singleLanePlacements(graph, bandStep, crossStride)
    : lanePlacements(graph, bandStep, crossStride, subStep)

  const nodes: AccessSceneNode[] = graph.nodes.map((node) => {
    const { rank: rankCoord, cross } = placements.get(node.id) ?? { rank: MARGIN, cross: 0 }
    const height = nodeHeightFor(node.kind)
    // Rank-axis from the node's band; cross-axis from the de-overlapped lane.
    const x = vertical ? cross : rankCoord
    let y = vertical ? rankCoord : cross
    // In LR the cross axis is Y and a lane is centered on its cross midpoint.
    // The placement centers the STANDARD card box; a taller user card must be
    // lifted by half its extra height so its vertical CENTER still sits on the
    // lane axis (and lines up with the role lane beside it). In TB the extra
    // height is on the rank axis and grows into the inter-rank gap, so no nudge.
    if (!vertical) y -= (height - NODE_HEIGHT) / 2
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
        // Only the drilled-in user card carries completion. It is an option
        // (not read off this graph) so a filtered scene still reports the
        // user's full set of access items.
        ...(node.kind === 'user' && options.completion !== undefined
          ? { completion: options.completion }
          : {}),
      },
      width: NODE_WIDTH,
      height,
      sourcePosition: handle.sourcePosition,
      targetPosition: handle.targetPosition,
      draggable: false,
      connectable: false,
      // Cards sit above every edge layer (status edges use zIndex 1), so a
      // status line that passes behind another card never strikes through its
      // name. Edges still stack status-over-reference among themselves.
      zIndex: CARD_Z_INDEX,
    }
  })

  // Plain built-in React Flow edges (no custom edge type). The user→access-item
  // edge conveys review status via stroke color + dash across FOUR states:
  //   needsReview → dashed amber (--vc-warn),
  //   approved    → solid green (--vc-allow),
  //   revoked     → solid red (--vc-deny),
  //   reassigned  → dotted blue (--vc-accent, terminal).
  // approved vs revoked differ by COLOR only on this edge; the node's
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
        return { stroke: 'var(--vc-warn)', strokeWidth: 3, strokeDasharray: '6 4' }
      case 'approved':
        return { stroke: 'var(--vc-allow)', strokeWidth: 3 }
      case 'revoked':
        return { stroke: 'var(--vc-deny)', strokeWidth: 3 }
      case 'reassigned':
        return { stroke: 'var(--vc-accent)', strokeWidth: 3, strokeDasharray: '2 3' }
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
      style: { stroke: 'var(--edge)', strokeWidth: 2, opacity: 0.45 },
      zIndex: 0,
    }
  })
  return { nodes, edges }
}
