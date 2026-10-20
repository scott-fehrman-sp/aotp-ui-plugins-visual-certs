import { useMemo } from 'react'
import { DeadlineGauge } from '../components/charts/DeadlineGauge'
import { DecisionBar } from '../components/charts/DecisionBar'
import { PriorityBreakdown } from '../components/charts/PriorityBreakdown'
import { ProgressDonut } from '../components/charts/ProgressDonut'
import { MetricCard } from '../components/MetricCard'
import { computeAccessCounts } from '../domain/accessCounts'
import { computeMetrics } from '../domain/metrics'
import { countByPriority, prioritize } from '../domain/priority'
import type { AccessMatrixState } from '../state/useAccessMatrix'
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
  /**
   * The expanded access matrix state. When provided, the overview shows
   * distinct user / access-item / source counts derived from the SAME
   * fully-expanded graph that powers the access map, so the numbers match it
   * exactly. The cards show a placeholder until the matrix resolves. When
   * omitted the composition cards are not rendered (keeps existing tests
   * intact).
   */
  matrix?: AccessMatrixState
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
  onViewMatrix,
  matrix,
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

  // Distinct user / access-item / source counts from the expanded access graph
  // (the same one the map renders). Computed only once the matrix is ready; a
  // placeholder shows while it resolves.
  const accessCounts = useMemo(
    () =>
      matrix && matrix.status === 'ready'
        ? computeAccessCounts(matrix.graph)
        : null,
    [matrix],
  )
  // The composition cards resolve independently of the decision metrics, so
  // show a dash while loading and keep the layout stable.
  const countsLoading = matrix != null && matrix.status !== 'ready'
  const countOrDash = (value: number | undefined): string | number =>
    accessCounts && value !== undefined ? value : countsLoading ? '—' : 0

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
        <MetricCard label="Still to review" value={metrics.remaining} tone="accent" />
        <MetricCard label="Reviewed" value={metrics.reviewed} />
        <MetricCard label="Kept" value={metrics.approved} tone="allow" />
        <MetricCard label="Removed" value={metrics.revoked} tone="deny" />
        <MetricCard label="Reassigned" value={metrics.reassigned} tone="reassign" />
      </div>

      {/* "What's in this review" — distinct counts from the expanded access map.
          Rendered only when the matrix state is wired in. */}
      {matrix && (
        <div
          className="vc-metrics-row vc-metrics-row-access"
          aria-busy={countsLoading}
        >
          <MetricCard label="Users" value={countOrDash(accessCounts?.users)} />
          <MetricCard
            label="Access items"
            value={countOrDash(accessCounts?.accessItems)}
          />
          <MetricCard label="Sources" value={countOrDash(accessCounts?.sources)} />
        </div>
      )}

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
