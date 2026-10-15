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
  /** Current time, injectable for tests. */
  now?: Date
}

/**
 * The guided, chart-first landing page for a campaign. It answers "where do I
 * start?" with a single prominent call to action plus visuals that show how far
 * along the review is, what the decisions look like so far, how much really
 * needs attention, and how much time is left.
 */
export function CampaignDashboard({
  campaign,
  items,
  onStartReviewing,
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
        {!allDone && (
          <button
            type="button"
            className="vc-btn vc-btn-primary vc-cta"
            onClick={onStartReviewing}
          >
            {ctaLabel}
          </button>
        )}
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
        <MetricCard label="Still to review" value={metrics.remaining} tone="accent" />
        <MetricCard label="Reviewed" value={metrics.reviewed} />
        <MetricCard label="Kept" value={metrics.approved} tone="allow" />
        <MetricCard label="Removed" value={metrics.revoked} tone="deny" />
        <MetricCard label="Reassigned" value={metrics.reassigned} tone="reassign" />
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
