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
  AccessFlag,
  AccessGraphData,
  AccessGraphNodeKind,
  AccessReviewStatus,
  ReviewItemVM,
} from '../sailpoint/types'
import { accessFlagDetails, accessFlagNotes, mergeAccessFlags, mergeFlagNotes } from './accessFlags'
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
  /**
   * Union of the access flags on the review items for this key, in display
   * order. Empty when none of the items carry a flag.
   */
  flags: AccessFlag[]
  /**
   * Extra text for a flag (end date, comment, impact). The first non-empty
   * note for each flag wins. Omitted when no flag has extra text.
   */
  flagNotes?: Partial<Record<AccessFlag, string>>
}

/**
 * Indexes review items by {@link reviewKey}. Generic `access`-kind items are
 * skipped (they have no graph node). Several items for one key collapse through
 * `aggregateReviewStatus` (order-independent).
 */
export function buildReviewIndex(
  items: ReviewItemVM[],
): Map<string, ReviewIndexEntry> {
  const grouped = new Map<string, ReviewItemVM[]>()
  for (const item of items) {
    if (item.accessKind === 'access') continue
    const key = reviewKey(
      item.identityId,
      item.accessKind,
      item.accessId,
      item.accessName,
    )
    const list = grouped.get(key)
    if (list) list.push(item)
    else grouped.set(key, [item])
  }

  const index = new Map<string, ReviewIndexEntry>()
  for (const [key, group] of grouped) {
    const aggregate = aggregateReviewStatus(group.map(reviewStatusOf))
    if (!aggregate) continue
    const flags = mergeAccessFlags(...group.map((item) => accessFlagDetails(item).map((detail) => detail.flag)))
    const flagNotes = mergeFlagNotes(...group.map(accessFlagNotes))
    index.set(key, {
      ...aggregate,
      flags,
      ...(Object.keys(flagNotes).length > 0 ? { flagNotes } : {}),
    })
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
      return {
        ...edge,
        reviewStatus: entry.status,
        reviewMixed: entry.mixed,
        ...(entry.flags.length > 0
          ? {
              reviewFlags: entry.flags,
              ...(entry.flagNotes ? { reviewFlagNotes: entry.flagNotes } : {}),
            }
          : {}),
      }
    }),
  }
}

/**
 * Copies live first-level review status from `source` onto the matching
 * first-level edges of `target`, joined by `reviewKey`. `nodes` keeps
 * `target`'s array reference.
 *
 * The lazily resolved per-user graph is structural only (`deriveAccessGraph`).
 * Status already lives on the shallow overview graph and changes with every
 * decision, so the drill-down copies it across instead of resolving again.
 * `userSubgraph` then stamps that edge status onto the first-level nodes.
 * Without this copy, the default "hide reference" filter treats every access
 * item as reference-only (no status) and the drill-down goes blank once
 * resolution finishes — cards and the "X% (Y of Z)" completion with them.
 */
export function copyFirstLevelStatus(
  target: AccessGraphData,
  source: AccessGraphData,
): AccessGraphData {
  const byKey = new Map<
    string,
    {
      reviewStatus: AccessReviewStatus
      reviewMixed?: boolean
      reviewFlags?: AccessFlag[]
      reviewFlagNotes?: Partial<Record<AccessFlag, string>>
    }
  >()
  for (const edge of source.edges) {
    if (!edge.firstLevel || edge.reviewKey === undefined || !edge.reviewStatus) continue
    byKey.set(edge.reviewKey, {
      reviewStatus: edge.reviewStatus,
      reviewMixed: edge.reviewMixed,
      reviewFlags: edge.reviewFlags,
      reviewFlagNotes: edge.reviewFlagNotes,
    })
  }
  if (byKey.size === 0) return target
  return {
    nodes: target.nodes,
    edges: target.edges.map((edge) => {
      if (!edge.firstLevel || edge.reviewKey === undefined) return edge
      const status = byKey.get(edge.reviewKey)
      if (!status) return edge
      return {
        ...edge,
        reviewStatus: status.reviewStatus,
        reviewMixed: status.reviewMixed,
        ...(status.reviewFlags?.length
          ? {
              reviewFlags: status.reviewFlags,
              ...(status.reviewFlagNotes ? { reviewFlagNotes: status.reviewFlagNotes } : {}),
            }
          : {}),
      }
    }),
  }
}
