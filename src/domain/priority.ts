/**
 * Priority ("attention") scoring for review items.
 *
 * WHY THIS EXISTS
 * ISC's access-review-items API cannot sort by risk, and it does not expose a
 * single numeric identity-level risk score on these items. To give a
 * non-technical reviewer a trustworthy "what to look at first" order, we derive
 * a 0–100 attention score from the risk signals that ARE present on each item,
 * then show the user, in plain language, exactly why each item scored the way
 * it did.
 *
 * HOW THE SCORE IS DERIVED
 * Each signal below contributes a fixed number of points when present. The
 * weights are ordered by how strongly the signal indicates "a human should look
 * closely", based on common certification practice:
 *
 *   - AI flagged for removal  (40): SailPoint's own Identity AI suggested this
 *       access be removed. This is the strongest single signal, so it dominates.
 *   - High-impact data        (25): the access can reach data classified as
 *       high impact (DAS impact score HIGH). Medium/low score less.
 *   - Elevated/admin access   (20): "privileged" entitlements grant powerful
 *       rights, so they deserve closer scrutiny.
 *   - New since last review   (12): access granted since the last campaign has
 *       never been reviewed by anyone and is worth confirming.
 *   - Rarely/never used       (8): access with 0 recorded usage days is a
 *       classic candidate for removal.
 *   - Cloud-governed          (5): touches cloud-governed resources; a mild
 *       nudge rather than a strong signal.
 *
 * The raw sum is capped at 100. These weights are the single source of truth and
 * are surfaced to the user through the "Why this order?" explainer so the
 * ordering is transparent and adjustable in one place.
 *
 * FALLBACK
 * If an item has NONE of these signals, its score is 0 and we fall back to a
 * stable alphabetical order (person name, then access name). When an entire
 * campaign has no signals, the UI tells the user the list is alphabetical
 * because limited risk data was available.
 */
import type { PriorityLevel, ReviewItemVM } from '../sailpoint/types'

/** Point weights for each signal. Documented rationale above. */
export const PRIORITY_WEIGHTS = {
  aiFlaggedForRemoval: 40,
  dataImpactHigh: 25,
  dataImpactMedium: 14,
  dataImpactLow: 6,
  privileged: 20,
  newAccess: 12,
  unused: 8,
  cloudGoverned: 5,
} as const

/** Score at/above which an item is shown as "high" priority, etc. */
export const PRIORITY_THRESHOLDS = {
  high: 45,
  medium: 20,
  low: 1,
} as const

/** A single plain-language reason an item was prioritized. */
export interface PriorityReason {
  /** Stable key for styling/testing. */
  key: string
  /** Short chip label shown on the card. */
  label: string
  /** Longer tooltip/explanation in business language. */
  explanation: string
  /** Points this reason contributed. */
  points: number
}

/** The computed priority for one item. */
export interface ItemPriority {
  /** 0–100 attention score. */
  score: number
  /** Bucket for charts and chip color. */
  level: PriorityLevel
  /** Plain-language reasons, highest-impact first. */
  reasons: PriorityReason[]
}

/**
 * Treats an item as "AI flagged for removal" when a recommendation string
 * clearly indicates denial. We check defensively because the recommendation
 * value is free-form text from the platform.
 */
function isAiFlaggedForRemoval(item: ReviewItemVM): boolean {
  const rec = item.aiRecommendation?.toUpperCase() ?? ''
  return rec.includes('DENY') || rec.includes('REVOKE') || rec.includes('REMOVE')
}

/** Computes the attention score and reasons for a single item. */
export function scoreItem(item: ReviewItemVM): ItemPriority {
  const reasons: PriorityReason[] = []

  if (isAiFlaggedForRemoval(item)) {
    reasons.push({
      key: 'ai',
      label: 'Flagged by SailPoint AI',
      explanation:
        "SailPoint's built-in AI suggests this access may no longer be appropriate.",
      points: PRIORITY_WEIGHTS.aiFlaggedForRemoval,
    })
  }

  if (item.dataImpact === 'high') {
    reasons.push({
      key: 'data-high',
      label: 'Reaches sensitive data',
      explanation:
        'This access can reach information classified as high impact, such as sensitive or regulated data.',
      points: PRIORITY_WEIGHTS.dataImpactHigh,
    })
  } else if (item.dataImpact === 'medium') {
    reasons.push({
      key: 'data-medium',
      label: 'Reaches moderately sensitive data',
      explanation: 'This access can reach data classified as medium impact.',
      points: PRIORITY_WEIGHTS.dataImpactMedium,
    })
  } else if (item.dataImpact === 'low') {
    reasons.push({
      key: 'data-low',
      label: 'Reaches lower-impact data',
      explanation: 'This access can reach data classified as low impact.',
      points: PRIORITY_WEIGHTS.dataImpactLow,
    })
  }

  if (item.isPrivileged) {
    reasons.push({
      key: 'privileged',
      label: 'Elevated / admin access',
      explanation:
        'This is powerful "admin" access that can make broad changes, so it deserves a close look.',
      points: PRIORITY_WEIGHTS.privileged,
    })
  }

  if (item.isNewAccess) {
    reasons.push({
      key: 'new',
      label: 'New since last review',
      explanation:
        'This access was granted since the last review, so no one has confirmed it yet.',
      points: PRIORITY_WEIGHTS.newAccess,
    })
  }

  // Unused only counts when usage data exists and shows zero days.
  if (item.usageDays === 0) {
    reasons.push({
      key: 'unused',
      label: 'Rarely used',
      explanation:
        "There's no recorded sign this access has been used, which can mean it is no longer needed.",
      points: PRIORITY_WEIGHTS.unused,
    })
  }

  if (item.isCloudGoverned) {
    reasons.push({
      key: 'cloud',
      label: 'Cloud-governed',
      explanation: 'This access touches cloud resources that are governed centrally.',
      points: PRIORITY_WEIGHTS.cloudGoverned,
    })
  }

  // Highest-impact reasons first so the chips read in order of importance.
  reasons.sort((a, b) => b.points - a.points)

  const score = Math.min(
    100,
    reasons.reduce((sum, r) => sum + r.points, 0),
  )

  return { score, level: toLevel(score), reasons }
}

/**
 * An item counts as resolved — and so leaves the reviewer's outstanding work —
 * once it has a decision (completed) OR has been reassigned to someone else.
 * Reassignment is a third outcome: the item is off this reviewer's plate even
 * though they never kept or removed it, so it sinks and drops out of the
 * outstanding tally just like a decided item.
 */
function isResolved(item: ReviewItemVM): boolean {
  return item.completed || item.reassigned
}

/** Maps a numeric score to a priority bucket. */
export function toLevel(score: number): PriorityLevel {
  if (score >= PRIORITY_THRESHOLDS.high) return 'high'
  if (score >= PRIORITY_THRESHOLDS.medium) return 'medium'
  if (score >= PRIORITY_THRESHOLDS.low) return 'low'
  return 'none'
}

/** A review item paired with its computed priority, ready for the UI. */
export interface PrioritizedItem {
  item: ReviewItemVM
  priority: ItemPriority
}

/**
 * Scores and orders items highest-attention first. Ties and no-signal items
 * fall back to a STABLE alphabetical order (person, then access) so the list
 * never shuffles between loads. Resolved items (decided or reassigned) sink to
 * the bottom so the reviewer always sees outstanding work first.
 */
export function prioritize(items: ReviewItemVM[]): PrioritizedItem[] {
  return items
    .map((item) => ({ item, priority: scoreItem(item) }))
    .sort((a, b) => {
      // Outstanding work first; resolved (decided or reassigned) items sink.
      const aResolved = isResolved(a.item)
      const bResolved = isResolved(b.item)
      if (aResolved !== bResolved) {
        return aResolved ? 1 : -1
      }
      // Higher score first.
      if (b.priority.score !== a.priority.score) {
        return b.priority.score - a.priority.score
      }
      // Stable alphabetical fallback.
      const byPerson = a.item.personName.localeCompare(b.item.personName)
      if (byPerson !== 0) return byPerson
      return a.item.accessName.localeCompare(b.item.accessName)
    })
}

/**
 * True when NO item in the campaign carries any risk signal, so the UI can
 * explain that the order is alphabetical due to limited data.
 */
export function hasNoRiskSignals(prioritized: PrioritizedItem[]): boolean {
  return prioritized.every((p) => p.priority.score === 0)
}

/** Counts of OUTSTANDING (not yet decided) items in each priority bucket. */
export interface PriorityCounts {
  high: number
  medium: number
  low: number
  none: number
}

/**
 * Tallies outstanding items by priority bucket for the dashboard chart.
 * Resolved items (decided or reassigned) are excluded so the chart reflects
 * only remaining work.
 */
export function countByPriority(prioritized: PrioritizedItem[]): PriorityCounts {
  const counts: PriorityCounts = { high: 0, medium: 0, low: 0, none: 0 }
  for (const { item, priority } of prioritized) {
    if (isResolved(item)) continue
    counts[priority.level]++
  }
  return counts
}
