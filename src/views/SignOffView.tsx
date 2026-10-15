import { useState } from 'react'
import { ErrorState } from '../components/ErrorState'
import { FriendlyError, signOff } from '../sailpoint/certifications'
import type { CertificationsApi } from 'sailpoint-api-client/certifications/api'
import type { CampaignVM } from '../sailpoint/types'
import './SignOffView.css'

interface SignOffViewProps {
  api: CertificationsApi
  campaign: CampaignVM
  /** Outstanding (not yet decided) count; sign-off is blocked while > 0. */
  outstanding: number
  totalItems: number
  approved: number
  revoked: number
  reassigned: number
  onBack: () => void
  /** Called with the updated (signed) campaign after a successful sign-off. */
  onSignedOff: (campaign: CampaignVM) => void
}

/**
 * The final step. Sign-off is irreversible and starts the actual access
 * changes, so it is gated until every item has a decision and guarded behind an
 * explicit, plain-language confirmation.
 */
export function SignOffView({
  api,
  campaign,
  outstanding,
  totalItems,
  approved,
  revoked,
  reassigned,
  onBack,
  onSignedOff,
}: SignOffViewProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  // Already finished (someone signed off previously).
  if (campaign.phase === 'done') {
    return (
      <section aria-label="Review complete" className="vc-signoff">
        <span className="vc-state-icon vc-state-icon-ok vc-signoff-icon" aria-hidden="true">
          ✓
        </span>
        <h2 className="vc-signoff-title">This review is complete</h2>
        <p className="vc-signoff-text">
          You've signed off on <strong>{campaign.name}</strong>. Any access you
          chose to remove is being taken care of. There's nothing more to do here.
        </p>
      </section>
    )
  }

  const canSignOff = totalItems > 0 && outstanding === 0

  const handleSignOff = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const updated = await signOff(api, campaign.id)
      onSignedOff(updated)
    } catch (err) {
      setError(
        err instanceof FriendlyError
          ? err.message
          : "We couldn't finish signing off. Please try again.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (error) {
    return (
      <div>
        <button type="button" className="vc-link-btn" onClick={onBack}>
          ← Back
        </button>
        <ErrorState
          title="We couldn't finish"
          message={error}
          onRetry={() => setError(null)}
        />
      </div>
    )
  }

  return (
    <section aria-label="Finish and sign off" className="vc-signoff">
      <button type="button" className="vc-link-btn" onClick={onBack}>
        ← Back to review
      </button>

      <h2 className="vc-signoff-title">Finish your review</h2>

      {!canSignOff ? (
        <div className="vc-signoff-blocked" role="status">
          <p>
            You still have <strong>{outstanding}</strong>{' '}
            {outstanding === 1 ? 'item' : 'items'} to decide. Once you've decided
            on everything, you can finish here.
          </p>
          <button type="button" className="vc-btn vc-btn-primary" onClick={onBack}>
            Go back and finish deciding
          </button>
        </div>
      ) : (
        <div className="vc-signoff-ready">
          <p className="vc-signoff-summary">
            You're about to confirm your decisions on{' '}
            <strong>{campaign.name}</strong>:
          </p>
          <ul className="vc-signoff-counts">
            <li>
              <span className="vc-signoff-keep">{approved} kept</span>
            </li>
            <li>
              <span className="vc-signoff-remove">{revoked} removed</span>
            </li>
            <li>
              <span className="vc-signoff-reassign">{reassigned} reassigned</span>
            </li>
          </ul>

          <div className="vc-signoff-warning">
            <strong>This is final.</strong> After you sign off, the access you
            chose to remove will actually be taken away, and you won't be able to
            change these decisions here.
          </div>

          <label className="vc-signoff-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={submitting}
            />
            I understand this will apply my decisions and can't be undone.
          </label>

          <button
            type="button"
            className="vc-btn vc-btn-primary vc-signoff-submit"
            onClick={handleSignOff}
            disabled={!confirmed || submitting}
          >
            {submitting ? 'Finishing…' : 'Sign off and finish'}
          </button>
        </div>
      )}
    </section>
  )
}
