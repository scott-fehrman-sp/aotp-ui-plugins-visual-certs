/**
 * Pure reference/first-level classification for the drill-down graph.
 *
 * A drill-down subgraph (already overlaid with the viewed user's review status
 * by `userSubgraph`) mixes two kinds of content: the REVIEWABLE first level
 * (the user's directly-held access items and the status edges to them) and
 * REFERENCE lineage (nested items and sources, drawn muted to explain how an
 * item derives access). The two predicates below are the single definition of
 * that split; `buildAccessScene` uses them to style the scene and
 * `withoutReference` uses them to drop the reference content, so what is hidden
 * is exactly what is drawn muted.
 *
 * Framework-pure: no React, no DOM, no mutation of the input.
 */
import type {
  AccessGraphData,
  AccessGraphEdge,
  AccessGraphNode,
} from '../sailpoint/types'

/** A non-user node without a review status is reference-only lineage. */
export function isReferenceNode(
  node: Pick<AccessGraphNode, 'kind' | 'reviewStatus'>,
): boolean {
  return node.kind !== 'user' && !node.reviewStatus
}

/** An edge with a review status is the user's reviewed first-level hop. */
export function isStatusEdge(edge: Pick<AccessGraphEdge, 'reviewStatus'>): boolean {
  return Boolean(edge.reviewStatus)
}

/**
 * Returns the graph with all reference content removed: only the user node,
 * the first-level (status-bearing) access items, and the status edges between
 * them remain. Relative order is preserved; the input is never mutated.
 */
export function withoutReference(graph: AccessGraphData): AccessGraphData {
  const nodes = graph.nodes.filter(
    (node) => node.kind === 'user' || !isReferenceNode(node),
  )
  const kept = new Set(nodes.map((node) => node.id))
  const edges = graph.edges.filter(
    (edge) => isStatusEdge(edge) && kept.has(edge.from) && kept.has(edge.to),
  )
  return { nodes, edges }
}
