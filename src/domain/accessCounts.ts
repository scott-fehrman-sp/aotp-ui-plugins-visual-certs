/**
 * Headline cardinalities for the campaign overview, derived from the SAME
 * fully-expanded access graph that powers the access map. Counting the graph's
 * already-deduped, kind-namespaced nodes guarantees the overview numbers match
 * the map exactly: distinct users, distinct leaf entitlements ("access items"),
 * and distinct sources after every role/access-profile has been expanded down
 * to its entitlements and each entitlement resolved to its source.
 *
 * Pure: no I/O, no mutation. An empty graph yields all-zero counts.
 */
import type { AccessGraphData } from '../sailpoint/types'

/** The three expanded counts shown on the overview. */
export interface AccessCounts {
  /** Distinct identities in the certification. */
  users: number
  /** Distinct leaf entitlements across every expanded path. */
  accessItems: number
  /** Distinct sources the expanded access lands on. */
  sources: number
}

/**
 * Counts distinct users / entitlements / sources in the derived access graph.
 * Graph nodes are already deduped by a kind-namespaced id, so a simple tally by
 * `kind` is the distinct count — no further de-duplication needed.
 */
export function computeAccessCounts(graph: AccessGraphData): AccessCounts {
  let users = 0
  let accessItems = 0
  let sources = 0
  for (const node of graph.nodes) {
    if (node.kind === 'user') users++
    else if (node.kind === 'entitlement') accessItems++
    else if (node.kind === 'source') sources++
  }
  return { users, accessItems, sources }
}
