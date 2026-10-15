import './states.css'

interface LoadingStateProps {
  /** Plain-language message describing what is loading. */
  message?: string
}

/**
 * Full-area loading indicator. Uses `role="status"` + `aria-live` so screen
 * readers announce progress instead of leaving users staring at a blank area.
 */
export function LoadingState({ message = 'Loading…' }: LoadingStateProps) {
  return (
    <div className="vc-state" role="status" aria-live="polite">
      <span className="vc-spinner" aria-hidden="true" />
      <p className="vc-state-message">{message}</p>
    </div>
  )
}
