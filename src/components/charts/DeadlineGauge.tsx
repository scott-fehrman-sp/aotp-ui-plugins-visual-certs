import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { deadlineText } from '../../domain/language'
import './charts.css'

interface DeadlineGaugeProps {
  /** Whole days until the deadline; negative when overdue; null if none. */
  daysRemaining: number | null
  /**
   * Total length of the review window in days, used to show how much time has
   * elapsed. Falls back to a sensible span when unknown.
   */
  totalWindowDays?: number | null
}

/**
 * Half-circle gauge showing how much of the review window is left. When there
 * is no deadline we show a plain message instead of a misleading empty gauge.
 */
export function DeadlineGauge({
  daysRemaining,
  totalWindowDays,
}: DeadlineGaugeProps) {
  if (daysRemaining === null) {
    return (
      <figure className="vc-chart">
        <figcaption className="vc-chart-title">Time left</figcaption>
        <div className="vc-chart-area vc-gauge-empty">
          <p className="vc-gauge-empty-text">No deadline set</p>
        </div>
      </figure>
    )
  }

  const overdue = daysRemaining < 0
  const window = totalWindowDays && totalWindowDays > 0 ? totalWindowDays : 30
  // Fraction of the window remaining, clamped to [0, 1].
  const fractionLeft = overdue
    ? 0
    : Math.max(0, Math.min(1, daysRemaining / window))

  const color = overdue
    ? 'var(--vc-deny)'
    : fractionLeft < 0.25
      ? 'var(--vc-warn)'
      : 'var(--vc-accent)'

  // Half-donut: the colored slice represents time remaining.
  const data = [
    { name: 'left', value: fractionLeft, fill: color },
    { name: 'spent', value: 1 - fractionLeft, fill: 'var(--vc-border)' },
  ]

  return (
    <figure className="vc-chart">
      <figcaption className="vc-chart-title">Time left</figcaption>
      <div className="vc-chart-area vc-gauge">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              startAngle={180}
              endAngle={0}
              cx="50%"
              cy="90%"
              innerRadius="70%"
              outerRadius="110%"
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="vc-gauge-center" aria-hidden="true">
          <span className="vc-gauge-text" data-overdue={overdue}>
            {deadlineText(daysRemaining)}
          </span>
        </div>
      </div>
      <p className="vc-visually-hidden">Time left: {deadlineText(daysRemaining)}.</p>
    </figure>
  )
}
