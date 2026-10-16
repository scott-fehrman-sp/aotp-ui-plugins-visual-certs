import { useId, useState } from 'react'
import type { ProvenanceEntry } from '../sailpoint/types'
import './AccessProvenance.css'

interface AccessProvenanceProps {
  /** The item's provenance entry (status + data), from useProvenance. */
  entry: ProvenanceEntry
}

/** Mechanisms we show with the "governed" accent tone (vs neutral). */
const ACCENT_MECHANISMS = new Set(['request', 'role'])

/**
 * The headline grant-mechanism badge plus an accessible, collapsed-by-default
 * "How they got this" disclosure. Reads entirely from a `ProvenanceEntry` so
 * `ReviewItemCard` stays lean. Provenance loads asynchronously after the card
 * first renders, so the badge container is an `aria-live` region and the
 * loading placeholder reserves the resolved badge's height to avoid a jump.
 *
 * Mechanism is conveyed by text (and an icon prefix), never color alone.
 */
export function AccessProvenance({ entry }: AccessProvenanceProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  const { status, data } = entry
  const accent = data != null && ACCENT_MECHANISMS.has(data.grantMechanism)

  return (
    <div className="vc-prov">
      {/* Badge: announced on arrival; height reserved in every state. */}
      <div className="vc-prov-badge-row" aria-live="polite">
        {status === 'loading' || status === 'idle' ? (
          <span className="vc-prov-badge vc-prov-badge-loading">
            Checking how they got this…
          </span>
        ) : status === 'unavailable' || data == null ? (
          <span className="vc-chip vc-prov-badge vc-prov-badge-neutral">
            How they got this isn't available
          </span>
        ) : (
          <span
            className={
              accent
                ? 'vc-chip vc-prov-badge vc-prov-badge-accent'
                : 'vc-chip vc-prov-badge vc-prov-badge-neutral'
            }
          >
            <span aria-hidden="true" className="vc-prov-badge-icon">
              {iconFor(data.grantMechanism)}
            </span>{' '}
            {data.mechanismLabel}
          </span>
        )}
      </div>

      {/* Disclosure: only offered once we have resolved data to show. */}
      {status === 'ready' && data != null && (
        <>
          <button
            type="button"
            className="vc-prov-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '▾' : '▸'} How they got this
          </button>
          {open && (
            <div id={panelId} className="vc-prov-panel">
              <ProvenanceDetails data={data} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** A small icon prefix so the mechanism isn't signalled by color alone. */
function iconFor(mechanism: string): string {
  switch (mechanism) {
    case 'request':
      return '📝'
    case 'role':
      return '🧩'
    case 'direct':
      return '➡️'
    default:
      return 'ℹ️'
  }
}

/** The plain-language body of the disclosure, driven by the view model. */
function ProvenanceDetails({
  data,
}: {
  data: NonNullable<ProvenanceEntry['data']>
}) {
  const { request, approvals, grantedOn, grantMechanism, historyUnavailable } =
    data

  if (request) {
    return (
      <div className="vc-prov-chain">
        <p className="vc-prov-step vc-prov-step-request">
          Requested
          {request.requestedBy ? (
            <>
              {' '}
              by <strong>{request.requestedBy}</strong>
            </>
          ) : null}
          {request.requestedOn ? <> on {formatDate(request.requestedOn)}</> : null}
        </p>
        {request.justification && (
          <blockquote className="vc-prov-justification">
            “{request.justification}”
          </blockquote>
        )}
        {approvals.length > 0 && (
          <ol className="vc-prov-approvals">
            {approvals.map((step, i) => (
              <li key={i} className="vc-prov-step">
                <span className="vc-prov-approver">
                  {step.approver ?? 'An approver'}
                </span>{' '}
                — {decisionText(step.decision)}
                {step.decidedOn ? <> on {formatDate(step.decidedOn)}</> : null}
                {step.comment && (
                  <span className="vc-prov-comment">“{step.comment}”</span>
                )}
              </li>
            ))}
          </ol>
        )}
        {grantedOn && (
          <p className="vc-prov-granted">Granted {formatDate(grantedOn)}</p>
        )}
      </div>
    )
  }

  // No request on record: say so honestly, and word the history-degraded case.
  if (grantMechanism === 'unknown' && historyUnavailable) {
    return <p className="vc-prov-empty">We couldn't load how this was granted.</p>
  }
  return (
    <div className="vc-prov-chain">
      <p className="vc-prov-empty">No access request on record for this item.</p>
      {grantedOn && (
        <p className="vc-prov-granted">Granted {formatDate(grantedOn)}</p>
      )}
    </div>
  )
}

/** Plain-language wording for an approval decision. */
function decisionText(decision: string): string {
  switch (decision) {
    case 'approved':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'pending':
      return 'pending'
    default:
      return 'reviewed'
  }
}

/** Formats an ISO date to a short, locale-aware date; passes through on error. */
function formatDate(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso
  return new Date(time).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
