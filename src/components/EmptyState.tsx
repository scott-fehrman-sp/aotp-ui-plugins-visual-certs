import type { ReactNode } from 'react'
import './states.css'

interface EmptyStateProps {
  /** Headline, e.g. "You're all caught up". */
  title: string
  /** Supportive explanation of why this is empty and what (if anything) to do. */
  message: string
  /** Optional action (e.g. a button) rendered below the message. */
  children?: ReactNode
}

/**
 * Positive, reassuring empty state — used when there is nothing to review or no
 * campaigns are assigned, so an empty screen never reads as an error.
 */
export function EmptyState({ title, message, children }: EmptyStateProps) {
  return (
    <div className="vc-state" role="status">
      <span className="vc-state-icon vc-state-icon-ok" aria-hidden="true">
        ✓
      </span>
      <h2 className="vc-state-title">{title}</h2>
      <p className="vc-state-message">{message}</p>
      {children}
    </div>
  )
}
