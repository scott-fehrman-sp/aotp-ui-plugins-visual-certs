/**
 * Progress and headline metrics for a campaign, derived from the campaign's
 * decision counts, the live review items, and the deadline. All pure functions
 * so the dashboard and charts can recompute instantly as decisions are made.
 */
import type {
  AccessReviewStatus,
  CampaignVM,
  ReviewItemVM,
} from '../sailpoint/types'

/** Everything the dashboard needs to render progress + headline numbers. */
export interface CampaignMetrics {
  /** Total items to review. */
  total: number
  /** Items with a decision recorded. */
  reviewed: number
  /** Items still needing a decision. */
  remaining: number
  /** Of the reviewed items, how many were kept (allowed). */
  approved: number
  /** Of the reviewed items, how many were removed (revoked). */
  revoked: number
  /** Of the reviewed items, how many were reassigned to someone else. */
  reassigned: number
  /** Percentage complete, 0–100, rounded. */
  percentComplete: number
  /** Whole days until the deadline; negative when overdue; null if no deadline. */
  daysRemaining: number | null
  /** True when there is a deadline and it has passed. */
  isOverdue: boolean
  /** True when every item has a decision. */
  isComplete: boolean
}

/**
 * Classifies a review item into the three-state review status, the SINGLE
 * source of truth for the "needs review vs complete vs delegated" rule. The
 * precedence is:
 *   - reassigned → `'delegated'` (TERMINAL for this reviewer, even if a
 *     decision was also recorded),
 *   - else a recorded keep/remove decision (`completed` or `decision != null`)
 *     → `'complete'`,
 *   - else → `'needsReview'`.
 * `computeMetrics` (via `isItemReviewed`) and the access-matrix review-status
 * stamp both derive from this so the dashboard and the graph can never disagree.
 */
export function reviewStatusOf(item: ReviewItemVM): AccessReviewStatus {
  if (item.reassigned === true) return 'delegated'
  if (item.completed || item.decision != null) return 'complete'
  return 'needsReview'
}

/**
 * Whether a review item counts as REVIEWED (resolved) rather than still needing
 * a decision. An item is reviewed when its {@link reviewStatusOf} is anything
 * other than `'needsReview'` — i.e. `'complete'` (a recorded keep/remove
 * decision) OR `'delegated'` (reassigned to someone else, which resolves the
 * item from this reviewer's perspective). Expressed in terms of
 * `reviewStatusOf` so the two helpers can never diverge.
 */
export function isItemReviewed(item: ReviewItemVM): boolean {
  return reviewStatusOf(item) !== 'needsReview'
}

/** Milliseconds in a day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Computes whole days from `now` until `due`. Rounds UP so "due later today"
 * still reads as 1 day left rather than 0. Returns null for a missing/invalid
 * date. `now` is injectable to keep the function pure and testable.
 */
export function daysUntil(
  due: string | null,
  now: Date = new Date(),
): number | null {
  if (!due) return null
  const dueMs = Date.parse(due)
  if (Number.isNaN(dueMs)) return null
  return Math.ceil((dueMs - now.getTime()) / MS_PER_DAY)
}

/**
 * Builds the metrics for a campaign.
 *
 * Approved/revoked counts come from the live review items (which carry each
 * item's recorded decision). Reviewed/remaining prefer the items when loaded,
 * and fall back to the campaign's own decision counts when items are not yet
 * available (e.g. on the dashboard before the queue loads).
 */
export function computeMetrics(
  campaign: CampaignVM,
  items: ReviewItemVM[] | null,
  now: Date = new Date(),
): CampaignMetrics {
  let total: number
  let reviewed = 0
  let approved = 0
  let revoked = 0
  let reassigned = 0

  if (items && items.length > 0) {
    total = items.length
    for (const item of items) {
      // A reassigned item is resolved from THIS reviewer's perspective: they
      // handed it to someone else, so it advances progress (reviewed/remaining/
      // percentComplete) but is a THIRD outcome — neither kept nor removed — so
      // it never counts toward approved or revoked.
      if (isItemReviewed(item)) {
        reviewed++
        if (item.decision === 'APPROVE') approved++
        else if (item.decision === 'REVOKE') revoked++
        else if (item.reassigned) reassigned++
      }
    }
  } else {
    // Fall back to the campaign's aggregate counts (approved/revoked/reassigned
    // unknown until the items load, so they stay at 0).
    total = campaign.decisionsTotal
    reviewed = campaign.decisionsMade
  }

  const remaining = Math.max(0, total - reviewed)
  const percentComplete = total > 0 ? Math.round((reviewed / total) * 100) : 0
  const daysRemaining = daysUntil(campaign.due, now)

  return {
    total,
    reviewed,
    remaining,
    approved,
    revoked,
    reassigned,
    percentComplete,
    daysRemaining,
    isOverdue: daysRemaining !== null && daysRemaining < 0,
    isComplete: total > 0 && remaining === 0,
  }
}
