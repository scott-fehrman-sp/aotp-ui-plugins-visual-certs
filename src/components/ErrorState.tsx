import './states.css'

interface ErrorStateProps {
  /** Short, plain-language headline, e.g. "We couldn't load your reviews". */
  title?: string
  /** A friendly explanation of what went wrong. Never raw API error text. */
  message: string
  /** Optional retry handler; renders a "Try again" button when provided. */
  onRetry?: () => void
}

/**
 * Friendly, non-technical error display so the interface never looks broken.
 * The caller passes an already-humanized message (see `toFriendlyError`).
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="vc-state vc-state-error" role="alert">
      <span className="vc-state-icon" aria-hidden="true">
        !
      </span>
      <h2 className="vc-state-title">{title}</h2>
      <p className="vc-state-message">{message}</p>
      {onRetry && (
        <button type="button" className="vc-btn vc-btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
