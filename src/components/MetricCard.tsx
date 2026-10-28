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
  /** Extra class on the card, for layout (for example a wider grid span). */
  className?: string
}

/** A single headline number with a plain-language label. */
export function MetricCard({
  label,
  value,
  hint,
  tone = 'neutral',
  className,
}: MetricCardProps) {
  return (
    <div className={className ? `vc-metric ${className}` : 'vc-metric'} data-tone={tone}>
      <div className="vc-metric-value">{value}</div>
      <div className="vc-metric-label">{label}</div>
      {hint && <div className="vc-metric-hint">{hint}</div>}
    </div>
  )
}
