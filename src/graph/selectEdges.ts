/**
 * Pure SELECTION restyle for the access graph's edges.
 *
 * A reviewer can select one FIRST-LEVEL access item (a role, access profile or
 * entitlement the user holds directly; a node that is not the user and not
 * reference-only). `highlightEdges` then highlights the item's ASSOCIATED
 * edges:
 *
 *  1. the incoming user -> item status edge, and
 *  2. every VISIBLE edge forward-reachable downstream of the item
 *     (item -> nested access profiles / entitlements -> ... -> sources).
 *
 * Both groups are raised above the cards and drawn in the selected item's
 * review-status color (the aggregated status when the item's rows disagree);
 * every other edge is dimmed. Because the lineage is derived from the edges
 * that are actually in the scene, hiding reference content leaves only the
 * user -> item edge, and showing it again restores the whole path.
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
 */
import type { Edge } from '@xyflow/react'
import type { AccessReviewStatus, AccessSceneNodeData } from '../sailpoint/types'
import {
  EMPHASIS_EDGE_Z_INDEX,
  EMPHASIS_STROKE_WIDTH,
  dimEdge,
  emphasizeEdges,
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
/** Stroke width of the solid lineage edges below the selected item. */
export const LINEAGE_STROKE_WIDTH = 2.5

/** Class on the selected item's user -> item edge (CSS makes it ignore the pointer). */
export const SELECTED_EDGE_CLASS = 'vc-graph-edge-selected'
/** Class on the lineage edges below the selected item. */
export const LINEAGE_EDGE_CLASS = 'vc-graph-edge-lineage'

/**
 * The single definition of "selectable": a first-level access item, i.e. not
 * the user and not a reference-only (nested or source) node.
 */
export function isSelectableNodeData(
  data: Pick<AccessSceneNodeData, 'kind' | 'reference'>,
): boolean {
  return data.kind !== 'user' && !data.reference
}

/**
 * Walks forward from `itemNodeId` over `edges`, visiting each node once (a
 * cycle cannot hang it). Returns the ids of every edge leaving a visited node,
 * and the ids of the nodes reached (the item itself excluded).
 */
function walkLineage(
  edges: Edge[],
  itemNodeId: string,
): { edgeIds: Set<string>; nodeIds: Set<string> } {
  const outgoing = new Map<string, Edge[]>()
  for (const edge of edges) {
    const list = outgoing.get(edge.source)
    if (list) list.push(edge)
    else outgoing.set(edge.source, [edge])
  }
  const edgeIds = new Set<string>()
  const nodeIds = new Set<string>()
  const visited = new Set<string>([itemNodeId])
  const queue: string[] = [itemNodeId]
  for (let head = 0; head < queue.length; head += 1) {
    for (const edge of outgoing.get(queue[head]) ?? []) {
      edgeIds.add(edge.id)
      if (visited.has(edge.target)) continue
      visited.add(edge.target)
      nodeIds.add(edge.target)
      queue.push(edge.target)
    }
  }
  return { edgeIds, nodeIds }
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

/** A solid, full-opacity, raised edge in the selected item's status color. */
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
      strokeDasharray: 'none',
      opacity: 1,
    },
  }
}

/**
 * Restyles `edges` for the current selection and hover/focus emphasis.
 *
 * - Nothing selected (or the selected node has no incoming status edge): exactly
 *   `emphasizeEdges(edges, emphasisId)`, including the same-array identity.
 * - Otherwise the selected item's user -> item edge and its lineage are
 *   highlighted in the item's status color and every other edge is dimmed.
 *   Hovering or focusing a DIFFERENT first-level item additionally raises that
 *   item's user -> item edge as a preview; the selected item adds nothing.
 */
export function highlightEdges(
  edges: Edge[],
  selectedId: string | null,
  emphasisId: string | null,
): Edge[] {
  if (selectedId === null) return emphasizeEdges(edges, emphasisId)
  const selectedEdge = incomingStatusEdge(edges, selectedId)
  if (!selectedEdge) return emphasizeEdges(edges, emphasisId)

  const status = (selectedEdge.data as { reviewStatus: AccessReviewStatus }).reviewStatus
  const lineage = lineageEdgeIds(edges, selectedId)
  lineage.delete(selectedEdge.id)
  const preview =
    emphasisId !== null && emphasisId !== selectedId
      ? incomingStatusEdge(edges, emphasisId)
      : undefined

  return edges.map((edge) => {
    if (edge === selectedEdge) return raiseEdge(edge, { className: SELECTED_EDGE_CLASS })
    if (lineage.has(edge.id)) return lineageEdge(edge, status)
    if (edge === preview) return raiseEdge(edge)
    return dimEdge(edge)
  })
}
