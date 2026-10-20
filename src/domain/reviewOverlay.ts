/**
 * The LIVE per-user review-status overlay for the access graph.
 *
 * Resolving access composition (role -> access profile -> entitlement -> source)
 * is expensive; review STATUS is cheap and changes on every keep/remove/reassign
 * decision. So status is never baked into resolved rows or the structural graph.
 * Instead `deriveAccessGraph` marks each user->item review hop structurally
 * (`firstLevel` + `reviewKey`), and this module joins the CURRENT review items
 * onto those edges whenever the items change.
 *
 * Both sides of the join use the review item's OWN identity (`identityId`,
 * `accessKind`, `accessId`, falling back to `accessName`), never the resolved
 * composition id, so an id-space difference between the review item and the
 * fetched role/AP/entitlement body can never break matching.
 *
 * Pure: no React, no I/O, no input mutation.
 */
import type {
  AccessGraphData,
  AccessGraphNodeKind,
  AccessReviewStatus,
  ReviewItemVM,
} from '../sailpoint/types'
import { aggregateReviewStatus, reviewStatusOf } from './metrics'

/**
 * The join key shared by graph edges and review items:
 * `<userId>|<kind>|<accessId>`, or `<userId>|<kind>|name:<accessName>` when the
 * item has no id.
 */
export function reviewKey(
  userId: string,
  kind: AccessGraphNodeKind,
  accessId: string | null | undefined,
  accessName: string,
): string {
  return `${userId}|${kind}|${accessId ?? `name:${accessName}`}`
}

/** One aggregated review outcome for a (user, access item) key. */
export interface ReviewIndexEntry {
  status: AccessReviewStatus
  /** True when the underlying review items do not all share one status. */
  mixed: boolean
}

/**
 * Indexes review items by {@link reviewKey}. Generic `access`-kind items are
 * skipped (they have no graph node). Several items for one key collapse through
 * `aggregateReviewStatus` (order-independent).
 */
export function buildReviewIndex(
  items: ReviewItemVM[],
): Map<string, ReviewIndexEntry> {
  const grouped = new Map<string, AccessReviewStatus[]>()
  for (const item of items) {
    if (item.accessKind === 'access') continue
    const key = reviewKey(
      item.identityId,
      item.accessKind,
      item.accessId,
      item.accessName,
    )
    const list = grouped.get(key)
    if (list) list.push(reviewStatusOf(item))
    else grouped.set(key, [reviewStatusOf(item)])
  }

  const index = new Map<string, ReviewIndexEntry>()
  for (const [key, statuses] of grouped) {
    const aggregate = aggregateReviewStatus(statuses)
    if (aggregate) index.set(key, aggregate)
  }
  return index
}

/**
 * Applies the current review statuses to a structural graph. Returns a new
 * `{ nodes, edges }` where `nodes` is the SAME array reference as the input (so
 * consumers can tell a status-only change from a structural one) and `edges` is
 * a fresh array in which only `firstLevel` edges with a matching review key get
 * `reviewStatus` / `reviewMixed`. Input edges are never mutated.
 */
export function applyReviewStatus(
  graph: AccessGraphData,
  items: ReviewItemVM[],
): AccessGraphData {
  const index = buildReviewIndex(items)
  return {
    nodes: graph.nodes,
    edges: graph.edges.map((edge) => {
      if (!edge.firstLevel || edge.reviewKey === undefined) return edge
      const entry = index.get(edge.reviewKey)
      if (!entry) return edge
      return { ...edge, reviewStatus: entry.status, reviewMixed: entry.mixed }
    }),
  }
}
