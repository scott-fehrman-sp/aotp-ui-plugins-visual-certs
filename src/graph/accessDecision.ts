/**
 * Which access items a drill-down decision applies to, and the review-item
 * keys the data layer uses to record it.
 *
 * Right-click on a needs-review item that is already selected acts on every
 * selected needs-review item. Right-click on a needs-review item that is not
 * selected acts on that item alone. A completed item is not actionable.
 */
import type { AccessGraphData } from '../sailpoint/types'

export type AccessDecisionAction = 'approve' | 'revoke' | 'reassign'

/** What the access-map dialog asks the data layer to record. */
export interface AccessDecisionRequest {
  action: AccessDecisionAction
  /** Review-item join keys for the access items being decided. */
  reviewKeys: string[]
  /** Final comment. Empty when the operator left the reason blank. */
  comment: string
  /** The person the items are handed to. Set only for a reassignment. */
  reassignToId?: string
}

const MENU_ACTION = {
  approved: 'approve',
  revoked: 'revoke',
  reassigned: 'reassign',
} as const

export function actionFromMenuStatus(
  status: keyof typeof MENU_ACTION,
): AccessDecisionAction {
  return MENU_ACTION[status]
}

/**
 * Node ids the decision applies to, or null when the right-clicked node is
 * not a needs-review access item. `selectedNeedsReviewIds` is the current
 * selection, already limited to needs-review access items, in selection order.
 */
export function decisionTargetIds(
  clickedId: string,
  clickedNeedsReview: boolean,
  selectedNeedsReviewIds: readonly string[],
): string[] | null {
  if (!clickedNeedsReview) return null
  if (selectedNeedsReviewIds.includes(clickedId)) return [...selectedNeedsReviewIds]
  return [clickedId]
}

/**
 * Review-item join keys for `nodeIds`, read off this user's first-level
 * edges. Order follows the graph's edge order. Nodes with no review hop are
 * skipped.
 */
export function reviewKeysForNodes(
  graph: AccessGraphData,
  userNodeId: string,
  nodeIds: readonly string[],
): string[] {
  const ids = new Set(nodeIds)
  const keys: string[] = []
  for (const edge of graph.edges) {
    if (edge.from === userNodeId && edge.firstLevel && edge.reviewKey && ids.has(edge.to)) {
      keys.push(edge.reviewKey)
    }
  }
  return keys
}

/** Live text after a decision is saved. `count` is the number of access items. */
export function decisionAnnouncement(action: AccessDecisionAction, count: number): string {
  const items = count === 1 ? '1 access item' : `${count} access items`
  if (action === 'approve') return `Approved ${items}.`
  if (action === 'revoke') return `Revoked ${items}.`
  return `Reassigned ${items}.`
}
