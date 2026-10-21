import { useState } from 'react'
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
  // The element the canvas portals its drill-down "Back to all users" button
  // into. Held in state (via a callback ref) so the canvas re-renders once the
  // slot exists. `null` until mounted tells the canvas to wait rather than fall
  // back to drawing the button inside the graph.
  const [backSlot, setBackSlot] = useState<HTMLElement | null>(null)

  return (
    <section className="vc-matrix-view" aria-label={`Access map for ${campaignName}`}>
      {/* One navigation row: leave the map, and (in a user's drill-down) go back
          to the all-users grid. Kept outside the canvas to save graph space. */}
      <nav className="vc-matrix-nav" aria-label="Access map navigation">
        <button type="button" className="vc-link-btn" onClick={onBack}>
          ← Back to overview
        </button>
        <span ref={setBackSlot} className="vc-matrix-nav-slot" />
      </nav>

      {/* The visible "All access paths" sub-heading was removed to give the
          graph more vertical room. A visually hidden heading keeps the page
          outline for screen-reader users at zero space cost. */}
      <h2 className="vc-matrix-sr-heading">All access paths</h2>

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

          <AccessGraphCanvas graph={matrix.graph} backSlot={backSlot} />
        </>
      )}
    </section>
  )
}
