import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import type { PriorityCounts } from '../../domain/priority'
import type { PriorityLevel } from '../../sailpoint/types'
import './charts.css'

interface PriorityBreakdownProps {
  counts: PriorityCounts
}

const ROWS: { key: PriorityLevel; label: string; color: string }[] = [
  { key: 'high', label: 'Needs a close look', color: 'var(--vc-pri-high)' },
  { key: 'medium', label: 'Worth checking', color: 'var(--vc-pri-medium)' },
  { key: 'low', label: 'Lower concern', color: 'var(--vc-pri-low)' },
  { key: 'none', label: 'Routine', color: 'var(--vc-pri-none)' },
]

/**
 * Bar chart of how many outstanding items fall into each priority bucket, so
 * the reviewer sees the shape of the work (how much really needs attention)
 * before diving in.
 */
export function PriorityBreakdown({ counts }: PriorityBreakdownProps) {
  const data = ROWS.map((r) => ({
    name: r.label,
    value: counts[r.key],
    fill: r.color,
  }))
  const max = Math.max(...data.map((d) => d.value), 1)

  return (
    <figure className="vc-chart">
      <figcaption className="vc-chart-title">What needs your attention</figcaption>
      <div className="vc-chart-area vc-chart-area-tall">
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
              width={150}
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
        Outstanding items by priority: {counts.high} need a close look,{' '}
        {counts.medium} worth checking, {counts.low} lower concern, {counts.none}{' '}
        routine.
      </p>
    </figure>
  )
}
