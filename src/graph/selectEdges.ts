/**
 * Pure SELECTION restyle for the access graph's edges.
 *
 * A reviewer can select any node except the user. For a FIRST-LEVEL access item
 * (a role, access profile or entitlement the user holds directly),
 * `highlightEdges` highlights the item's ASSOCIATED edges:
 *
 *  1. the incoming user -> item status edge, and
 *  2. every VISIBLE edge forward-reachable downstream of the item
 *     (item -> nested access profiles / entitlements -> ... -> sources).
 *
 * Both groups are raised above the cards and drawn in the selected item's
 * review-status color (the aggregated status when the item's rows disagree);
 * every other edge is dimmed. The drill-down does not draw the user -> item
 * edge (one user makes that hop noise). When it is absent, the downstream
 * lineage is still highlighted from `options.reviewStatus`. Because the
 * lineage is derived from the edges that are actually in the scene, hiding
 * reference content leaves no edge, and showing it again restores the path.
 *
 * A reference-only node (a nested item, an attribute, or a source) has no
 * status edge. Selecting it highlights every visible edge on a directed path
 * through it — upstream toward the user and downstream toward the source —
 * keeping each edge's own stroke, and dims the rest. A source therefore lights
 * the links that reach it, and an attribute lights both the entitlements that
 * use it and its source.
 *
 * Upstream edges are NOT associated: when an entitlement is both held directly
 * AND nested under a held role, selecting the entitlement does not highlight
 * the role -> ... -> entitlement reference edges above it. Including them later
 * is a one-line change: in `walkLineage`, also seed the edges whose `target` is
 * the item and that are reference edges.
 *
 * Like `emphasizeEdges` this is presentation only. It never touches node
 * positions, layout or the viewport, so selecting never refits. Deterministic
 * and non-mutating; with nothing selected it returns exactly what
 * `emphasizeEdges` returns, so today's hover/focus behavior is unchanged.
 *
 * Several access items that still need review can be selected together.
 * `highlightSelection` highlights each of their lineages in that item's own
 * status color and dims everything else. A single selected node takes the
 * same path as `highlightEdges`.
 */
import type { Edge } from '@xyflow/react'
import type { AccessReviewStatus, AccessSceneNodeData } from '../sailpoint/types'
import {
  EMPHASIS_EDGE_Z_INDEX,
  EMPHASIS_STROKE_WIDTH,
  dimEdge,
  emphasizeEdges,
  hasReviewStatus,
  incomingStatusEdge,
  raiseEdge,
} from './emphasizeEdges'

/** Stroke of the lineage edges per status (same tokens as the scene's status edges). */
export const STATUS_STROKE: Record<AccessReviewStatus, string> = {
  needsReview: 'var(--vc-warn)',
  approved: 'var(--vc-allow)',
  revoked: 'var(--vc-deny)',
  reassigned: 'var(--vc-accent)',
}

/** Stroke width of the selected item's user -> item edge. */
export const SELECTION_STROKE_WIDTH = EMPHASIS_STROKE_WIDTH
/** Stroke width of the lineage edges below the selected item. */
export const LINEAGE_STROKE_WIDTH = 3.5

/** Class on the selected item's user -> item edge (CSS makes it ignore the pointer). */
export const SELECTED_EDGE_CLASS = 'vc-graph-edge-selected'
/** Class on the lineage edges below the selected item. */
export const LINEAGE_EDGE_CLASS = 'vc-graph-edge-lineage'

/**
 * The single definition of "selectable": every node except the user. Reference
 * nodes (nested items, attributes, sources) select too, so their links can be
 * highlighted; the user card drills in or opens details and is not a selection.
 */
export function isSelectableNodeData(
  data: Pick<AccessSceneNodeData, 'kind' | 'reference'>,
): boolean {
  return data.kind !== 'user'
}

const MULTI_SELECT_KINDS = new Set<AccessSceneNodeData['kind']>([
  'role',
  'accessProfile',
  'entitlement',
])

/**
 * An access item still awaiting a decision. These are the only cards that
 * accumulate in one selection. Completed items and reference-only nodes stay
 * one at a time.
 */
export function isNeedsReviewItem(
  data: Pick<AccessSceneNodeData, 'kind' | 'reference' | 'reviewStatus'>,
): boolean {
  return (
    !data.reference &&
    data.reviewStatus === 'needsReview' &&
    MULTI_SELECT_KINDS.has(data.kind)
  )
}

/**
 * Walks `direction` from `startId` over `edges`, visiting each node once (a
 * cycle cannot hang it). Returns the ids of every edge traversed and the ids
 * of the nodes reached (the start itself excluded).
 */
function walk(
  edges: Edge[],
  startId: string,
  direction: 'out' | 'in',
): { edgeIds: Set<string>; nodeIds: Set<string> } {
  const adjacent = new Map<string, Edge[]>()
  for (const edge of edges) {
    const key = direction === 'out' ? edge.source : edge.target
    const list = adjacent.get(key)
    if (list) list.push(edge)
    else adjacent.set(key, [edge])
  }
  const edgeIds = new Set<string>()
  const nodeIds = new Set<string>()
  const visited = new Set<string>([startId])
  const queue: string[] = [startId]
  for (let head = 0; head < queue.length; head += 1) {
    for (const edge of adjacent.get(queue[head]) ?? []) {
      edgeIds.add(edge.id)
      const next = direction === 'out' ? edge.target : edge.source
      if (visited.has(next)) continue
      visited.add(next)
      nodeIds.add(next)
      queue.push(next)
    }
  }
  return { edgeIds, nodeIds }
}

/** Forward walk: edges leaving the start, and the nodes downstream of it. */
function walkLineage(
  edges: Edge[],
  itemNodeId: string,
): { edgeIds: Set<string>; nodeIds: Set<string> } {
  return walk(edges, itemNodeId, 'out')
}

/**
 * Ids of every edge forward-reachable downstream of `itemNodeId` over `edges`
 * (the visible scene edges). Excludes the incoming user -> item edge and any
 * upstream edge. Unknown id or no outgoing edges gives an empty set.
 */
export function lineageEdgeIds(edges: Edge[], itemNodeId: string): Set<string> {
  return walkLineage(edges, itemNodeId).edgeIds
}

/** Ids of the nodes reachable downstream of `itemNodeId` (never the item itself). */
export function lineageNodeIds(edges: Edge[], itemNodeId: string): Set<string> {
  return walkLineage(edges, itemNodeId).nodeIds
}

/**
 * Edges on any directed path through `nodeId`: everything downstream of it and
 * everything upstream of it. The node's own id is not an edge. Unknown id or
 * an isolated node gives an empty set.
 */
export function connectedEdgeIds(edges: Edge[], nodeId: string): Set<string> {
  const downstream = walk(edges, nodeId, 'out')
  const upstream = walk(edges, nodeId, 'in')
  return new Set([...downstream.edgeIds, ...upstream.edgeIds])
}

/** Nodes on any directed path through `nodeId` (never the node itself). */
export function connectedNodeIds(edges: Edge[], nodeId: string): Set<string> {
  const downstream = walk(edges, nodeId, 'out')
  const upstream = walk(edges, nodeId, 'in')
  return new Set([...downstream.nodeIds, ...upstream.nodeIds])
}

/**
 * A full-opacity, raised edge in the selected item's status color. The dash
 * pattern is left to CSS (`.vc-graph-edge-lineage`): the highlighted path
 * marches source → target. Forcing `strokeDasharray` here would freeze it.
 */
function lineageEdge(edge: Edge, status: AccessReviewStatus): Edge {
  return {
    ...edge,
    zIndex: EMPHASIS_EDGE_Z_INDEX,
    interactionWidth: 0,
    className: `${edge.className ?? ''} ${LINEAGE_EDGE_CLASS}`.trim(),
    style: {
      ...edge.style,
      stroke: STATUS_STROKE[status],
      strokeWidth: LINEAGE_STROKE_WIDTH,
      opacity: 1,
    },
  }
}

/**
 * Raises one edge of a reference-node selection. A status edge keeps its color
 * and dash and is thickened like a hover; a reference hairline keeps its stroke
 * and is drawn at full opacity. Either way it sits above the cards and, with
 * the lineage class, marches source → target.
 */
function highlightConnectedEdge(edge: Edge): Edge {
  if (hasReviewStatus(edge)) return raiseEdge(edge, { className: LINEAGE_EDGE_CLASS })
  return {
    ...edge,
    zIndex: EMPHASIS_EDGE_Z_INDEX,
    interactionWidth: 0,
    className: `${edge.className ?? ''} ${LINEAGE_EDGE_CLASS}`.trim(),
    style: {
      ...edge.style,
      strokeWidth: LINEAGE_STROKE_WIDTH,
      opacity: 1,
    },
  }
}

/**
 * Highlights the path through a reference node and dims every other edge.
 * An isolated node (no incident edge) falls back to hover emphasis.
 */
function highlightReferenceEdges(
  edges: Edge[],
  selectedId: string,
  emphasisId: string | null,
): Edge[] {
  const connected = connectedEdgeIds(edges, selectedId)
  if (connected.size === 0) return emphasizeEdges(edges, emphasisId)
  const preview =
    emphasisId !== null && emphasisId !== selectedId
      ? incomingStatusEdge(edges, emphasisId)
      : undefined
  return edges.map((edge) => {
    if (connected.has(edge.id)) return highlightConnectedEdge(edge)
    if (edge === preview) return raiseEdge(edge)
    return dimEdge(edge)
  })
}

/** Highlight options. `reference` selects a nested item, attribute, or source. */
export interface HighlightOptions {
  /**
   * The selected node is reference-only. Highlight the path through it in both
   * directions instead of the first-level status-edge treatment.
   */
  reference?: boolean
  /**
   * Review status of a selected first-level item. Colors its downstream lineage
   * when the user -> item edge is not in `edges`.
   */
  reviewStatus?: AccessReviewStatus
  /**
   * Status of each selected item when more than one is selected. Each
   * lineage is colored with its own item's status. The first selected item
   * that reaches a shared edge decides that edge's color.
   */
  reviewStatuses?: Readonly<Record<string, AccessReviewStatus>>
}

/**
 * Restyles `edges` for the current selection and hover/focus emphasis.
 *
 * - Nothing selected, or a non-reference node with no incoming status edge:
 *   exactly `emphasizeEdges(edges, emphasisId)`, including the same-array identity.
 * - A first-level item: its downstream lineage is highlighted in the item's
 *   status color and every other edge is dimmed. A user -> item edge, when one
 *   is still in the list, is raised too.
 * - A reference node (`options.reference`): every edge on a path through it is
 *   raised, keeping its own stroke, and every other edge is dimmed.
 * Hovering or focusing a DIFFERENT first-level item additionally raises that
 * item's user -> item edge as a preview; the selected item adds nothing.
 */
export function highlightEdges(
  edges: Edge[],
  selectedId: string | null,
  emphasisId: string | null,
  options?: HighlightOptions,
): Edge[] {
  if (selectedId === null) return emphasizeEdges(edges, emphasisId)
  if (options?.reference) return highlightReferenceEdges(edges, selectedId, emphasisId)
  const selectedEdge = incomingStatusEdge(edges, selectedId)
  const status =
    (selectedEdge?.data as { reviewStatus?: AccessReviewStatus } | undefined)?.reviewStatus ??
    options?.reviewStatus
  if (!status) return emphasizeEdges(edges, emphasisId)

  const lineage = lineageEdgeIds(edges, selectedId)
  if (selectedEdge) lineage.delete(selectedEdge.id)
  const preview =
    emphasisId !== null && emphasisId !== selectedId
      ? incomingStatusEdge(edges, emphasisId)
      : undefined

  return edges.map((edge) => {
    if (selectedEdge && edge === selectedEdge) {
      return raiseEdge(edge, { className: SELECTED_EDGE_CLASS })
    }
    if (lineage.has(edge.id)) return lineageEdge(edge, status)
    if (edge === preview) return raiseEdge(edge)
    return dimEdge(edge)
  })
}

/**
 * Restyle for several selected first-level items at once. Each item's
 * downstream lineage uses that item's status. An edge reached by more than
 * one item keeps the color of the earliest selected item.
 */
function highlightManyEdges(
  edges: Edge[],
  selectedIds: readonly string[],
  emphasisId: string | null,
  reviewStatuses: Readonly<Record<string, AccessReviewStatus>> | undefined,
): Edge[] {
  const selected = new Set(selectedIds)
  const selectedEdgeIds = new Set<string>()
  const lineageStatus = new Map<string, AccessReviewStatus>()
  for (const id of selectedIds) {
    const status = reviewStatuses?.[id]
    if (!status) continue
    const incoming = incomingStatusEdge(edges, id)
    if (incoming) selectedEdgeIds.add(incoming.id)
    const lineage = lineageEdgeIds(edges, id)
    if (incoming) lineage.delete(incoming.id)
    for (const edgeId of lineage) {
      if (!lineageStatus.has(edgeId)) lineageStatus.set(edgeId, status)
    }
  }
  if (selectedEdgeIds.size === 0 && lineageStatus.size === 0) {
    return emphasizeEdges(edges, emphasisId)
  }
  const preview =
    emphasisId !== null && !selected.has(emphasisId)
      ? incomingStatusEdge(edges, emphasisId)
      : undefined
  return edges.map((edge) => {
    if (selectedEdgeIds.has(edge.id)) return raiseEdge(edge, { className: SELECTED_EDGE_CLASS })
    const status = lineageStatus.get(edge.id)
    if (status) return lineageEdge(edge, status)
    if (preview && edge === preview) return raiseEdge(edge)
    return dimEdge(edge)
  })
}

/**
 * Selection restyle for one node or several. An empty list and a single id
 * are exactly `highlightEdges`, so one selected card looks the same as before.
 */
export function highlightSelection(
  edges: Edge[],
  selectedId: string | readonly string[] | null,
  emphasisId: string | null,
  options?: HighlightOptions,
): Edge[] {
  if (selectedId === null || typeof selectedId === 'string') {
    return highlightEdges(edges, selectedId, emphasisId, options)
  }
  if (selectedId.length <= 1) {
    return highlightEdges(edges, selectedId[0] ?? null, emphasisId, options)
  }
  return highlightManyEdges(edges, selectedId, emphasisId, options?.reviewStatuses)
}
