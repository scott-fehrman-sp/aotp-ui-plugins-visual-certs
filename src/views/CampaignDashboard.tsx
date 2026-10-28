import { useMemo } from 'react'
import { DeadlineGauge } from '../components/charts/DeadlineGauge'
import { DecisionBar } from '../components/charts/DecisionBar'
import { PriorityBreakdown } from '../components/charts/PriorityBreakdown'
import { ProgressDonut } from '../components/charts/ProgressDonut'
import { MetricCard } from '../components/MetricCard'
import { computeMetrics } from '../domain/metrics'
import { countByPriority, prioritize } from '../domain/priority'
import type { CampaignVM, ReviewItemVM } from '../sailpoint/types'
import './CampaignDashboard.css'

interface CampaignDashboardProps {
  campaign: CampaignVM
  /** Review items for the campaign; null while still loading. */
  items: ReviewItemVM[] | null
  /** Called when the user chooses to start/continue reviewing. */
  onStartReviewing: () => void
  /**
   * Called when the user opens the access expansion matrix. When omitted the
   * "View access map" button is not rendered (keeps existing layout/tests
   * intact).
   */
  onViewMatrix?: () => void
  /** Current time, injectable for tests. */
  now?: Date
}

/**
 * The guided, chart-first landing page for a campaign. It answers "where do I
 * start?" with a single prominent call to action plus visuals that show how far
 * along the review is, what the decisions look like so far, how much really
 * needs attention, and how much time is left.
 *
 * Shows only data about the SELECTED CERTIFICATION itself (decision tallies,
 * priority, deadline, and the access-item and user counts already in hand) —
 * never a metric that requires expanding role / access-profile / entitlement /
 * source composition. Those four APIs are only ever called once a user is
 * selected for processing on the access map (see `useAccessMatrix`'s doc), so
 * this overview never triggers them, no matter how many users or items the
 * campaign has. The user count is the number of distinct `identityId`s on the
 * review items already loaded for this certification.
 */
export function CampaignDashboard({
  campaign,
  items,
  onStartReviewing,
  onViewMatrix,
  now,
}: CampaignDashboardProps) {
  const metrics = useMemo(
    () => computeMetrics(campaign, items, now),
    [campaign, items, now],
  )

  const priorityCounts = useMemo(
    () => (items ? countByPriority(prioritize(items)) : null),
    [items],
  )

  // Both counts come straight from the review items already loaded for this
  // certification. Access items is one per review item (the first-level role,
  // access profile, or entitlement the reviewer can act on). Users is the
  // number of distinct identities those items belong to. Neither calls the
  // role / access-profile / entitlement / source APIs.
  const accessItemCount: string | number = items ? items.length : '—'
  const userCount: string | number = items ? countUsers(items) : '—'

  const highCount = priorityCounts?.high ?? 0
  const ctaLabel = metrics.reviewed > 0 ? 'Continue reviewing' : 'Start reviewing'
  const allDone = metrics.isComplete

  return (
    <section className="vc-dashboard" aria-label={`Overview of ${campaign.name}`}>
      <div className="vc-dashboard-head">
        <div>
          <h2 className="vc-dashboard-title">{campaign.name}</h2>
          {campaign.description && (
            <p className="vc-dashboard-desc">{campaign.description}</p>
          )}
        </div>
        {/* Actions row is always present so the access map stays reachable even
            on a completed campaign (where the primary CTA is hidden). */}
        <div className="vc-dashboard-actions">
          {!allDone && (
            <button
              type="button"
              className="vc-btn vc-btn-primary vc-cta"
              onClick={onStartReviewing}
            >
              {ctaLabel}
            </button>
          )}
          {onViewMatrix && (
            <button
              type="button"
              className="vc-btn vc-btn-secondary"
              onClick={onViewMatrix}
            >
              View access map
            </button>
          )}
        </div>
      </div>

      {/* Guided "start here" guidance in plain language. */}
      <p className="vc-guidance">
        {allDone
          ? "You've made a decision on everything. You can review your choices or sign off when you're ready."
          : highCount > 0
            ? `We suggest starting with the ${highCount} ${
                highCount === 1 ? 'item that needs' : 'items that need'
              } a close look — they're first in your list.`
            : "We've put the most important items first, so just start at the top and work down."}
      </p>

      <div className="vc-metrics-row">
        <MetricCard label="Users" value={userCount} hint="Identities in this review" />
        <MetricCard
          label="Access items"
          value={accessItemCount}
          hint="Directly assigned to users"
        />
        <MetricCard label="Still to review" value={metrics.remaining} tone="accent" />
        <MetricCard label="Reviewed" value={metrics.reviewed} />
        <MetricCard label="Kept" value={metrics.approved} tone="allow" />
        <MetricCard label="Removed" value={metrics.revoked} tone="deny" />
      </div>

      <div className="vc-charts-grid">
        <ProgressDonut
          reviewed={metrics.reviewed}
          remaining={metrics.remaining}
          percentComplete={metrics.percentComplete}
        />
        <DecisionBar
          approved={metrics.approved}
          revoked={metrics.revoked}
          reassigned={metrics.reassigned}
        />
        <DeadlineGauge daysRemaining={metrics.daysRemaining} />
        {priorityCounts && <PriorityBreakdown counts={priorityCounts} />}
      </div>
    </section>
  )
}

/** Distinct identities among the already-loaded review items. A blank
 * `identityId` (the API never set one) is skipped so it is not counted as a
 * user of its own. */
function countUsers(items: ReviewItemVM[]): number {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.identityId) ids.add(item.identityId)
  }
  return ids.size
}
