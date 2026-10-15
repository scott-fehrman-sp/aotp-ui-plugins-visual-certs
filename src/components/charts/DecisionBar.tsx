import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import './charts.css'

interface DecisionBarProps {
  /** How many were kept (allowed). */
  approved: number
  /** How many were removed (revoked). */
  revoked: number
  /** How many were reassigned to someone else. */
  reassigned: number
}

/**
 * Horizontal bar comparing kept vs removed vs reassigned decisions so far.
 * Updates live as the reviewer decides. A hidden summary mirrors the values for
 * screen readers.
 */
export function DecisionBar({ approved, revoked, reassigned }: DecisionBarProps) {
  const data = [
    { name: 'Kept', value: approved, fill: 'var(--vc-allow)' },
    { name: 'Removed', value: revoked, fill: 'var(--vc-deny)' },
    // Reassign is the neutral third outcome, so it reuses the blue accent token
    // the reassign action already uses (see .vc-btn-reassign) rather than the
    // keep/remove greens/reds.
    { name: 'Reassigned', value: reassigned, fill: 'var(--vc-accent)' },
  ]
  const max = Math.max(approved, revoked, reassigned, 1)

  return (
    <figure className="vc-chart">
      <figcaption className="vc-chart-title">Your decisions so far</figcaption>
      <div className="vc-chart-area">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 28, bottom: 4, left: 8 }}
          >
            <XAxis type="number" domain={[0, max]} hide />
            <YAxis
              type="category"
              dataKey="name"
              width={70}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--vc-text-muted)', fontSize: 13 }}
            />
            <Bar dataKey="value" radius={[4, 4, 4, 4]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.fill} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                fill="var(--vc-text)"
                fontSize={13}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="vc-visually-hidden">
        {approved} kept, {revoked} removed, {reassigned} reassigned.
      </p>
    </figure>
  )
}
