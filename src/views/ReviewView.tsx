import { useState } from 'react'
import { DrillDownTable } from '../components/DrillDownTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { ReviewQueue } from '../components/ReviewQueue'
import type { ReviewItemsState } from '../state/useReviewItems'
import type { DecisionChoice } from '../sailpoint/types'
import './ReviewView.css'

interface ReviewViewProps {
  campaignName: string
  /** The loaded, prioritized items + status (from useReviewItems). */
  review: ReviewItemsState
  /** Back to the campaign dashboard. */
  onBack: () => void
  /** Open a decision for an item (the dialog is wired in Task 8). */
  onDecide: (itemId: string, choice: DecisionChoice) => void
  /** Jump to the sign-off step (enabled once everything is decided). */
  onSignOff?: () => void
}

/**
 * The review step: a prioritized, visual queue of everything to decide, with a
 * clear starting point. Handles its own loading / empty / error states so the
 * screen never looks broken.
 */
export function ReviewView({
  campaignName,
  review,
  onBack,
  onDecide,
  onSignOff,
}: ReviewViewProps) {
  const { loading, error, ordered, noRiskSignals, reload } = review
  const [showTable, setShowTable] = useState(false)

  const outstanding = ordered.filter((o) => !o.item.completed).length
  const total = ordered.length
  const allDecided = total > 0 && outstanding === 0

  return (
    <section aria-label={`Review items for ${campaignName}`}>
      <button type="button" className="vc-link-btn" onClick={onBack}>
        ← Back to overview
      </button>

      <div className="vc-review-head">
        <h2 className="vc-review-title">What to review</h2>
        {total > 0 && (
          <div className="vc-review-head-right">
            <p className="vc-review-count">
              {outstanding > 0
                ? `${outstanding} of ${total} still to decide`
                : 'Everything has a decision'}
            </p>
            <button
              type="button"
              className="vc-link-btn"
              aria-pressed={showTable}
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable ? 'Show cards' : 'Show as a table'}
            </button>
          </div>
        )}
      </div>

      {loading && <LoadingState message="Loading the items to review…" />}

      {!loading && error && (
        <ErrorState
          title="We couldn't load the items"
          message={error}
          onRetry={reload}
        />
      )}

      {!loading && !error && total === 0 && (
        <EmptyState
          title="Nothing to review"
          message="There are no access items to review in this one. You're all set here."
        />
      )}

      {!loading && !error && total > 0 && (
        <>
          {showTable ? (
            <DrillDownTable ordered={ordered} />
          ) : (
            <ReviewQueue
              ordered={ordered}
              noRiskSignals={noRiskSignals}
              onDecide={onDecide}
            />
          )}
          {allDecided && onSignOff && (
            <div className="vc-review-footer">
              <p>You've decided on everything. Ready to finish?</p>
              <button
                type="button"
                className="vc-btn vc-btn-primary"
                onClick={onSignOff}
              >
                Review and sign off
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
