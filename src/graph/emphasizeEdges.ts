/**
 * Pure hover/focus emphasis for the access graph's edges.
 *
 * In shown-reference mode a status edge can pass behind a card that is not its
 * endpoint, so the reviewer cannot follow the line. When a first-level card is
 * hovered or keyboard-focused, `emphasizeEdges` raises THAT item's incoming
 * user -> item status edge above every card, thickens it, and dims every other
 * edge so the one path stands out.
 *
 * It is a presentation-only restyle of the edges React Flow is given: no node
 * position, layout or viewport input changes, so nothing refits. Deterministic
 * and non-mutating; returns the SAME array when there is nothing to emphasize.
 *
 * The small building blocks (`incomingStatusEdge`, `raiseEdge`, `dimEdge`) are
 * exported so the selection restyle (`selectEdges.ts`) composes with this
 * emphasis instead of duplicating it.
 */
import type { Edge } from '@xyflow/react'

/** Above `CARD_Z_INDEX` (2) so the edge paints over crossed cards. */
export const EMPHASIS_EDGE_Z_INDEX = 10
/** Stroke width of the emphasized edge (status default is 3). */
export const EMPHASIS_STROKE_WIDTH = 4.5
/** Opacity of the non-emphasized status edges. */
export const DIM_STATUS_OPACITY = 0.25
/** Opacity of the reference edges (already 0.45 at rest). */
export const DIM_REFERENCE_OPACITY = 0.12

/** Class added to the raised edge (CSS makes it ignore the pointer). */
export const EMPHASIZED_EDGE_CLASS = 'vc-graph-edge-emphasized'

/** True for the user's first-level status edge (it carries a review status). */
export const hasReviewStatus = (edge: Edge): boolean =>
  typeof (edge.data as { reviewStatus?: unknown } | undefined)?.reviewStatus === 'string'

/** The incoming user -> item status edge of `nodeId`, if it has one. */
export function incomingStatusEdge(edges: Edge[], nodeId: string): Edge | undefined {
  return edges.find((edge) => edge.target === nodeId && hasReviewStatus(edge))
}

/** Dims an edge (status edges less than reference hairlines). */
export function dimEdge(edge: Edge): Edge {
  return {
    ...edge,
    style: {
      ...edge.style,
      opacity: hasReviewStatus(edge) ? DIM_STATUS_OPACITY : DIM_REFERENCE_OPACITY,
    },
  }
}

/**
 * Raises an edge above the cards, thickens it, and makes it ignore the pointer.
 * `className` is appended (default: the emphasized class).
 */
export function raiseEdge(edge: Edge, options: { className?: string } = {}): Edge {
  return {
    ...edge,
    zIndex: EMPHASIS_EDGE_Z_INDEX,
    style: { ...edge.style, strokeWidth: EMPHASIS_STROKE_WIDTH },
    interactionWidth: 0,
    className: `${edge.className ?? ''} ${options.className ?? EMPHASIZED_EDGE_CLASS}`.trim(),
  }
}

/**
 * Emphasizes the incoming status edge of `focusedNodeId` and dims all others.
 * Returns `edges` itself (same reference) when `focusedNodeId` is null or has no
 * incoming status edge (the user, a reference-only node, an unknown id).
 */
export function emphasizeEdges(edges: Edge[], focusedNodeId: string | null): Edge[] {
  if (focusedNodeId === null) return edges
  const focused = incomingStatusEdge(edges, focusedNodeId)
  if (!focused) return edges
  return edges.map((edge) => (edge === focused ? raiseEdge(edge) : dimEdge(edge)))
}
