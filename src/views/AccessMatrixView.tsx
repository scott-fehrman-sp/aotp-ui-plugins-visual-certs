import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { AccessGraphCanvas } from '../graph/AccessGraphCanvas'
import type { AccessMatrixState } from '../state/useAccessMatrix'
import './AccessMatrixView.css'

interface AccessMatrixViewProps {
  campaignName: string
  /** The resolved matrix state (status/rows/graph/…) from useAccessMatrix. */
  matrix: AccessMatrixState
  /** Back to the campaign dashboard. */
  onBack: () => void
}

/**
 * The access expansion map screen: an interactive node/edge graph of every path
 * from a user down to a leaf entitlement on a source. The graph renders
 * `matrix.graph` (nodes across five layers user → role → access profile →
 * entitlement → source, blank levels skipped on a path) and is traversable from
 * either end. Handles its own loading/empty/error states and a non-fatal banner
 * for soft-degraded rows.
 */
export function AccessMatrixView({
  campaignName,
  matrix,
  onBack,
}: AccessMatrixViewProps) {
  return (
    <section aria-label={`Access map for ${campaignName}`}>
      <button type="button" className="vc-link-btn" onClick={onBack}>
        ← Back to overview
      </button>

      <div className="vc-matrix-head">
        <h2 className="vc-matrix-title">All access paths</h2>
      </div>

      {matrix.status === 'loading' && (
        <LoadingState message="Building the access map…" />
      )}

      {matrix.status === 'error' && (
        <ErrorState
          title="We couldn't build the access map"
          message={
            matrix.error ??
            "Something went wrong while expanding access. Please try again."
          }
          onRetry={matrix.reload}
        />
      )}

      {matrix.status === 'ready' && matrix.rows.length === 0 && (
        <EmptyState
          title="No access to map"
          message="There's no reviewable access to expand into a map for this review."
        />
      )}

      {matrix.status === 'ready' && matrix.rows.length > 0 && (
        <>
          {matrix.unresolvedCount > 0 && (
            <div className="vc-banner" role="status">
              <span>
                {matrix.unresolvedCount}{' '}
                {matrix.unresolvedCount === 1
                  ? 'access path couldn’t'
                  : 'access paths couldn’t'}{' '}
                be fully resolved and{' '}
                {matrix.unresolvedCount === 1 ? 'is' : 'are'} marked Unresolved.
              </span>
            </div>
          )}

          <AccessGraphCanvas graph={matrix.graph} />
        </>
      )}
    </section>
  )
}
