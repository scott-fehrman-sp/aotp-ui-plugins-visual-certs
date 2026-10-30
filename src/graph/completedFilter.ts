/**
 * Pure "hide completed access items" filter for the drill-down graph.
 *
 * A COMPLETED item is a first-level access item (role, access profile or
 * directly-held entitlement) whose aggregated review status is `approved`,
 * `revoked` or `reassigned`. `needsReview`, a first-level edge with no status
 * and a mixed-status item (which aggregates to `needsReview`) are never
 * completed, so they are never hidden.
 *
 * Hiding uses REACHABILITY PRUNING, not "delete the item's descendants": the
 * user -> completed-item edges are dropped, then exactly the nodes still
 * reachable from the user node are kept, with every edge whose source is kept.
 * Lineage (nested items, sources) shared with a still-visible item therefore
 * stays, connected only through the visible item; lineage reachable only
 * through hidden items disappears.
 *
 * A node that was a completed first-level item but survives as lineage under a
 * visible item is DEMOTED to a reference-only node (its `reviewStatus` /
 * `reviewMixed` are removed), so the scene draws it as a muted, non-selectable
 * nested card with no status ring or icon, like any other lineage node.
 *
 * Framework-pure: no React, no DOM, no mutation of the input. Order preserving.
 */
import type {
  AccessGraphData,
  AccessGraphEdge,
  AccessReviewStatus,
  UserCompletion,
} from '../sailpoint/types'
import { withAttributeEntitlementCounts } from '../domain/attributeEntitlementCounts'

/** The result of {@link withoutCompleted}. */
export interface CompletedFilterResult {
  /** The graph with completed first-level items (and orphaned lineage) removed. */
  graph: AccessGraphData
  /** Distinct first-level completed ITEMS that were hidden. */
  hiddenCount: number
}

/** `approved`, `revoked` and `reassigned` are completed; anything else is not. */
export function isCompletedStatus(status?: AccessReviewStatus): boolean {
  return status === 'approved' || status === 'revoked' || status === 'reassigned'
}

/** A user -> item edge of the reviewed first level whose status is completed. */
export function isCompletedEdge(
  edge: Pick<AccessGraphEdge, 'firstLevel' | 'reviewStatus'>,
): boolean {
  return Boolean(edge.firstLevel) && isCompletedStatus(edge.reviewStatus)
}

/**
 * Completion of one user's first-level access items: how many are done, how
 * many there are, and the rounded percentage. An access item is a first-level
 * edge that carries a review status — the same set {@link withoutCompleted}
 * hides. `approved`, `revoked` and `reassigned` count as completed;
 * `needsReview` does not. Nested lineage and edges with no review status are
 * not access items and are ignored.
 *
 * Pass the user's UNFILTERED edges. Hiding completed items removes those
 * edges, so counting the visible graph would report the wrong figures.
 * A user with no reviewable items is `{ percent: 0, completed: 0, total: 0 }`.
 */
export function userCompletion(
  edges: readonly Pick<AccessGraphEdge, 'from' | 'firstLevel' | 'reviewStatus'>[],
  userNodeId: string,
): UserCompletion {
  let total = 0
  let completed = 0
  for (const edge of edges) {
    if (edge.from !== userNodeId || !edge.firstLevel || !edge.reviewStatus) continue
    total += 1
    if (isCompletedStatus(edge.reviewStatus)) completed += 1
  }
  return {
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    completed,
    total,
  }
}

/** Rounded percentage (0–100) from {@link userCompletion}. */
export function completionPercent(
  edges: readonly Pick<AccessGraphEdge, 'from' | 'firstLevel' | 'reviewStatus'>[],
  userNodeId: string,
): number {
  return userCompletion(edges, userNodeId).percent
}

/**
 * Returns the graph without its completed first-level items and any lineage
 * that is no longer reachable from the user, plus how many items were hidden.
 * When nothing is completed the SAME graph object is returned (stable memo
 * identity).
 */
export function withoutCompleted(graph: AccessGraphData): CompletedFilterResult {
  const remaining = graph.edges.filter((edge) => !isCompletedEdge(edge))
  if (remaining.length === graph.edges.length) {
    return { graph, hiddenCount: 0 }
  }
  const hiddenItems = new Set(
    graph.edges.filter(isCompletedEdge).map((edge) => edge.to),
  )

  const outgoing = new Map<string, AccessGraphEdge[]>()
  for (const edge of remaining) {
    const list = outgoing.get(edge.from)
    if (list) list.push(edge)
    else outgoing.set(edge.from, [edge])
  }

  const visited = new Set<string>()
  const queue: string[] = []
  for (const node of graph.nodes) {
    if (node.kind === 'user') {
      visited.add(node.id)
      queue.push(node.id)
    }
  }
  for (let i = 0; i < queue.length; i += 1) {
    for (const edge of outgoing.get(queue[i]) ?? []) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to)
        queue.push(edge.to)
      }
    }
  }

  const edges = remaining.filter((edge) => visited.has(edge.from))
  // Nodes that are still the target of a kept status edge stay reviewable.
  const stillReviewed = new Set(
    edges
      .filter((edge) => edge.firstLevel && edge.reviewStatus)
      .map((edge) => edge.to),
  )
  const nodes = graph.nodes
    .filter((node) => visited.has(node.id))
    .map((node) => {
      if (node.kind === 'user' || !node.reviewStatus || stillReviewed.has(node.id)) {
        return node
      }
      const copy = { ...node }
      delete copy.reviewStatus
      delete copy.reviewMixed
      // Assignment flags belong to the review hop. Once the item is only
      // lineage, those flags no longer describe a decision on this node.
      // Catalog flags on `flags` stay.
      delete copy.reviewFlags
      delete copy.reviewFlagNotes
      return copy
    })

  return {
    graph: withAttributeEntitlementCounts({ nodes, edges }),
    hiddenCount: hiddenItems.size,
  }
}
