import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { SearchApi } from 'sailpoint-api-client/search/api'
import { CANNED_COMMENTS } from '../domain/language'
import type { AccessDecisionAction } from '../graph/accessDecision'
import type { CommentRequirement, DecisionChoice, IdentityOption } from '../sailpoint/types'
import { IdentityPicker } from './IdentityPicker'
import './DecisionDialog.css'

interface AccessDecisionDialogProps {
  action: AccessDecisionAction
  /** How many selected access items this action will change. */
  count: number
  /** The campaign's comment rule. Reassign always requires a reason. */
  commentRequirement: CommentRequirement
  submitting: boolean
  /** Shown when the last attempt to save failed. */
  error?: string | null
  onConfirm: (comment: string) => void
  onCancel: () => void
  /** Search API for the reassign flow. Required when the action is reassign. */
  searchApi?: SearchApi
  onConfirmReassign?: (identityId: string, comment: string) => void
}

const NO_COMMENT = '__none__'
const CUSTOM = '__custom__'

const TITLE: Record<AccessDecisionAction, string> = {
  approve: 'Approve Access',
  revoke: 'Revoke Access',
  reassign: 'Reassign Access',
}

/** Maps the access-map action onto the shared canned-comment lists. */
const COMMENT_CHOICE: Record<AccessDecisionAction, DecisionChoice> = {
  approve: 'allow',
  revoke: 'remove',
  reassign: 'reassign',
}

const MEANING_CHOICE: Record<AccessDecisionAction, 'allow' | 'remove' | 'reassign'> = {
  approve: 'allow',
  revoke: 'remove',
  reassign: 'reassign',
}

function commentRequired(
  requirement: CommentRequirement,
  action: AccessDecisionAction,
): boolean {
  if (action === 'reassign') return true
  if (requirement === 'all') return true
  if (requirement === 'revokeOnly') return action === 'revoke'
  return false
}

function countLabel(count: number): string {
  return count === 1 ? '1 access item' : `${count} access items`
}

/** What the action will do to every selected access item. */
function actionDescription(action: AccessDecisionAction, count: number): string {
  if (action === 'approve') {
    return count === 1
      ? 'This access item will be approved. The person keeps it, and nothing changes for them.'
      : `All ${count} selected access items will be approved. The people who have them keep that access, and nothing changes for them.`
  }
  if (action === 'revoke') {
    return count === 1
      ? 'This access item will be revoked. It will be taken away after you sign off, and the person will no longer be able to use it.'
      : `All ${count} selected access items will be revoked. They will be taken away after you sign off, and the people who have them will no longer be able to use that access.`
  }
  return count === 1
    ? 'This access item will be reassigned to the person you choose. It leaves your list, and that person reviews it instead.'
    : `All ${count} selected access items will be reassigned to the person you choose. They leave your list, and that person reviews them instead.`
}

/**
 * Confirmation for approving, revoking, or reassigning the access items the
 * operator selected on the map. One comment (a suggested reason, or their
 * own) applies to every item. Reassign also asks who should review them.
 */
export function AccessDecisionDialog({
  action,
  count,
  commentRequirement,
  submitting,
  error,
  onConfirm,
  onCancel,
  searchApi,
  onConfirmReassign,
}: AccessDecisionDialogProps) {
  const titleId = useId()
  const countId = useId()
  const descId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const isReassign = action === 'reassign'
  const suggestions = CANNED_COMMENTS[COMMENT_CHOICE[action]]
  const required = commentRequired(commentRequirement, action)
  const title = TITLE[action]

  const [selected, setSelected] = useState<string>(required ? '' : NO_COMMENT)
  const [customText, setCustomText] = useState('')
  const [recipient, setRecipient] = useState<IdentityOption | null>(null)

  const comment = useMemo(() => {
    if (selected === CUSTOM) return customText.trim()
    if (selected === NO_COMMENT || selected === '') return ''
    return selected
  }, [selected, customText])

  const canConfirm = isReassign
    ? !submitting && recipient !== null && comment.length > 0
    : !submitting && (!required || comment.length > 0)

  const cancel = () => {
    if (!submitting) onCancel()
  }

  const confirmReassign = () => {
    if (recipient) onConfirmReassign?.(recipient.id, comment)
  }

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || submitting) return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, submitting])

  return (
    <div className="vc-dialog-backdrop" role="presentation" onClick={cancel}>
      <div
        className="vc-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${countId} ${descId}`}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="vc-dialog-title">
          {title}
          <span id={countId} className="vc-dialog-count">
            {countLabel(count)}
          </span>
        </h2>

        <p id={descId} className="vc-dialog-meaning" data-choice={MEANING_CHOICE[action]}>
          {actionDescription(action, count)}
        </p>

        {isReassign && (
          <>
            <label className="vc-dialog-label" htmlFor={`${titleId}-recipient`}>
              Assign to (required)
            </label>
            {searchApi ? (
              <IdentityPicker
                inputId={`${titleId}-recipient`}
                searchApi={searchApi}
                value={recipient}
                onChange={setRecipient}
                disabled={submitting}
              />
            ) : (
              <p className="vc-dialog-hint">Search for a person isn&rsquo;t available right now.</p>
            )}
            {searchApi && recipient === null && (
              <p className="vc-dialog-hint">
                Search for the person who should review {count === 1 ? 'this item' : 'these items'}.
              </p>
            )}
          </>
        )}

        <label className="vc-dialog-label" htmlFor={`${titleId}-comment`}>
          {required ? 'Reason (required)' : 'Reason (optional)'}
        </label>
        <select
          id={`${titleId}-comment`}
          className="vc-dialog-select"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          disabled={submitting}
        >
          {!required && <option value={NO_COMMENT}>No comment</option>}
          {required && selected === '' && (
            <option value="" disabled>
              Choose a reason…
            </option>
          )}
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion}>
              {suggestion}
            </option>
          ))}
          <option value={CUSTOM}>Write my own…</option>
        </select>

        {selected === CUSTOM && (
          <textarea
            className="vc-dialog-textarea"
            placeholder="Type your reason…"
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            disabled={submitting}
            rows={3}
            aria-label="Your reason"
            autoFocus
          />
        )}

        {required && comment.length === 0 && (
          <p className="vc-dialog-hint">
            This review asks for a reason before you can {action} this access.
          </p>
        )}

        {error && (
          <p className="vc-dialog-error" role="alert">
            {error}
          </p>
        )}

        <div className="vc-dialog-actions">
          <button
            type="button"
            className="vc-btn vc-btn-secondary"
            onClick={cancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={
              isReassign
                ? 'vc-btn vc-btn-reassign'
                : action === 'approve'
                  ? 'vc-btn vc-btn-allow'
                  : 'vc-btn vc-btn-deny'
            }
            onClick={isReassign ? confirmReassign : () => onConfirm(comment)}
            disabled={!canConfirm}
          >
            {submitting ? 'Saving…' : title}
          </button>
        </div>
      </div>
    </div>
  )
}
