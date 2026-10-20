/**
 * Headline cardinalities for the campaign overview.
 *
 * Two different sources, on purpose:
 *
 *  - ACCESS ITEMS is the number of items the reviewer can actually act on: the
 *    roles, access profiles and directly-held entitlements assigned to users
 *    (the FIRST level only). That is exactly the set of review items, so it is
 *    counted from them directly. Anything nested beneath a role or access
 *    profile is lineage shown for reference on the access map; it is not
 *    reviewable and is never counted here.
 *  - USERS and SOURCES come from the expanded access graph (the same one the
 *    access map draws): distinct users, and distinct sources the assigned
 *    access ultimately reaches. Sources are reference lineage, but "how many
 *    systems does this review touch" is still useful context.
 *
 * Pure: no I/O, no mutation. Empty inputs yield zero counts.
 */
import type { AccessGraphData, ReviewItemVM } from '../sailpoint/types'

/** The three counts shown on the overview. */
export interface AccessCounts {
  /** Distinct identities in the certification. */
  users: number
  /**
   * First-level access items under review: the roles, access profiles and
   * direct entitlements assigned to users. One per review item.
   */
  accessItems: number
  /** Distinct sources the assigned access reaches (via the expanded lineage). */
  sources: number
}

/**
 * Counts users and sources from the derived access graph (nodes are already
 * deduped by a kind-namespaced id, so a tally by `kind` is the distinct count)
 * and access items from the review items. `items` is `null` while the review
 * items are still loading, in which case access items is 0.
 */
export function computeAccessCounts(
  graph: AccessGraphData,
  items: ReviewItemVM[] | null,
): AccessCounts {
  let users = 0
  let sources = 0
  for (const node of graph.nodes) {
    if (node.kind === 'user') users++
    else if (node.kind === 'source') sources++
  }
  return { users, accessItems: items ? items.length : 0, sources }
}
