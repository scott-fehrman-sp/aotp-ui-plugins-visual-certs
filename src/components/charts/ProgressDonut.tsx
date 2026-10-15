import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import './charts.css'

interface ProgressDonutProps {
  /** Items already reviewed. */
  reviewed: number
  /** Items still remaining. */
  remaining: number
  /** Percent complete, 0–100 (shown in the center). */
  percentComplete: number
}

/**
 * Donut showing how much of the review is done. The center shows the percent
 * so the headline is readable at a glance; a visually-hidden summary gives the
 * same information to screen readers (Recharts SVG alone is not descriptive).
 */
export function ProgressDonut({
  reviewed,
  remaining,
  percentComplete,
}: ProgressDonutProps) {
  const data = [
    { name: 'Reviewed', value: reviewed, fill: 'var(--vc-allow)' },
    { name: 'Still to review', value: remaining, fill: 'var(--vc-border)' },
  ]
  const hasData = reviewed + remaining > 0

  return (
    <figure className="vc-chart">
      <figcaption className="vc-chart-title">Your progress</figcaption>
      <div className="vc-chart-area vc-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={hasData ? data : [{ name: 'none', value: 1, fill: 'var(--vc-border)' }]}
              dataKey="value"
              innerRadius="68%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              stroke="none"
              isAnimationActive={false}
            >
              {(hasData ? data : [{ fill: 'var(--vc-border)' }]).map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="vc-donut-center" aria-hidden="true">
          <span className="vc-donut-percent">{percentComplete}%</span>
          <span className="vc-donut-sub">done</span>
        </div>
      </div>
      <p className="vc-visually-hidden">
        {percentComplete}% complete: {reviewed} reviewed, {remaining} still to review.
      </p>
    </figure>
  )
}
