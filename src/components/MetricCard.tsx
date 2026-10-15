import type { ReactNode } from 'react'
import './MetricCard.css'

interface MetricCardProps {
  /** Plain-language label, e.g. "Still to review". */
  label: string
  /** The headline value (number or short string). */
  value: ReactNode
  /** Optional secondary detail under the value. */
  hint?: string
  /** Accent tone for the value. */
  tone?: 'neutral' | 'allow' | 'deny' | 'warn' | 'accent' | 'reassign'
}

/** A single headline number with a plain-language label. */
export function MetricCard({ label, value, hint, tone = 'neutral' }: MetricCardProps) {
  return (
    <div className="vc-metric" data-tone={tone}>
      <div className="vc-metric-value">{value}</div>
      <div className="vc-metric-label">{label}</div>
      {hint && <div className="vc-metric-hint">{hint}</div>}
    </div>
  )
}
