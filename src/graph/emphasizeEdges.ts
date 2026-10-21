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
 */
import type { Edge } from '@xyflow/react'

/** Above `CARD_Z_INDEX` (2) so the edge paints over crossed cards. */
export const EMPHASIS_EDGE_Z_INDEX = 10
/** Stroke width of the emphasized edge (status default is 2). */
export const EMPHASIS_STROKE_WIDTH = 3.5
/** Opacity of the non-emphasized status edges. */
export const DIM_STATUS_OPACITY = 0.25
/** Opacity of the reference edges (already 0.45 at rest). */
export const DIM_REFERENCE_OPACITY = 0.12

/** Class added to the raised edge (CSS makes it ignore the pointer). */
export const EMPHASIZED_EDGE_CLASS = 'vc-graph-edge-emphasized'

const hasStatus = (edge: Edge): boolean =>
  typeof (edge.data as { reviewStatus?: unknown } | undefined)?.reviewStatus === 'string'

/**
 * Emphasizes the incoming status edge of `focusedNodeId` and dims all others.
 * Returns `edges` itself (same reference) when `focusedNodeId` is null or has no
 * incoming status edge (the user, a reference-only node, an unknown id).
 */
export function emphasizeEdges(edges: Edge[], focusedNodeId: string | null): Edge[] {
  if (focusedNodeId === null) return edges
  const focused = edges.find((edge) => edge.target === focusedNodeId && hasStatus(edge))
  if (!focused) return edges
  return edges.map((edge) => {
    if (edge === focused) {
      return {
        ...edge,
        zIndex: EMPHASIS_EDGE_Z_INDEX,
        style: { ...edge.style, strokeWidth: EMPHASIS_STROKE_WIDTH },
        interactionWidth: 0,
        className: `${edge.className ?? ''} ${EMPHASIZED_EDGE_CLASS}`.trim(),
      }
    }
    return {
      ...edge,
      style: {
        ...edge.style,
        opacity: hasStatus(edge) ? DIM_STATUS_OPACITY : DIM_REFERENCE_OPACITY,
      },
    }
  })
}
