import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { SearchApi } from 'sailpoint-api-client/search/api'
import {
  CANNED_COMMENTS,
  DECISION_LABEL,
  DECISION_MEANING,
} from '../domain/language'
import type {
  CommentRequirement,
  DecisionChoice,
  IdentityOption,
  ReviewItemVM,
} from '../sailpoint/types'
import { IdentityPicker } from './IdentityPicker'
import './DecisionDialog.css'

interface DecisionDialogProps {
  item: ReviewItemVM
  choice: DecisionChoice
  /** The campaign's comment rule, which decides if a comment is mandatory. */
  commentRequirement: CommentRequirement
  /** True while the decision is being saved. */
  submitting: boolean
  /** Confirm with the final comment (empty string when none). */
  onConfirm: (comment: string) => void
  /** Cancel without deciding. */
  onCancel: () => void
  /** Search API for the reassign flow's identity picker. Required when the
   * choice is 'reassign'. */
  searchApi?: SearchApi
  /** Confirm a reassignment with the chosen person's id and a comment. Required
   * when the choice is 'reassign'. */
  onConfirmReassign?: (identityId: string, comment: string) => void
}

/** Sentinel values for the comment dropdown. */
const NO_COMMENT = '__none__'
const CUSTOM = '__custom__'

/**
 * Whether this choice requires a comment, given the campaign's rule:
 *  - 'all'        → every decision needs a comment
 *  - 'revokeOnly' → only "remove" needs a comment
 *  - 'none'       → never required
 */
function commentRequired(
  requirement: CommentRequirement,
  choice: DecisionChoice,
): boolean {
  if (requirement === 'all') return true
  if (requirement === 'revokeOnly') return choice === 'remove'
  return false
}

/**
 * Confirmation dialog for a single allow/remove decision. Explains in plain
 * business language what the decision does, then offers a comment combo box: a
 * dropdown of pre-defined, decision-relevant comments plus a "Write my own…"
 * option that reveals a free-text field. When the campaign requires a comment,
 * the confirm button stays disabled until one is provided.
 */
export function DecisionDialog({
  item,
  choice,
  commentRequirement,
  submitting,
  onConfirm,
  onCancel,
  searchApi,
  onConfirmReassign,
}: DecisionDialogProps) {
  const titleId = useId()
  const descId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  const isReassign = choice === 'reassign'
  const suggestions = CANNED_COMMENTS[choice]
  // Reassigning always needs a reason (who it goes to and why); keep/remove only
  // when the campaign's rule says so.
  const required = isReassign || commentRequired(commentRequirement, choice)

  // Selected dropdown value and the custom text (used only when CUSTOM chosen).
  const [selected, setSelected] = useState<string>(
    required ? '' : NO_COMMENT,
  )
  const [customText, setCustomText] = useState('')

  // Reassign mode: the person the item will be handed to.
  const [recipient, setRecipient] = useState<IdentityOption | null>(null)

  // The effective comment the decision will carry.
  const comment = useMemo(() => {
    if (selected === CUSTOM) return customText.trim()
    if (selected === NO_COMMENT || selected === '') return ''
    return selected
  }, [selected, customText])

  // Reassign needs BOTH a recipient and a comment; keep/remove only the comment
  // when the campaign requires one.
  const canConfirm = isReassign
    ? !submitting && recipient !== null && comment.length > 0
    : !submitting && (!required || comment.length > 0)

  const confirmReassign = () => {
    if (recipient) onConfirmReassign?.(recipient.id, comment)
  }

  // Move focus into the dialog and support Escape to cancel.
  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, submitting])

  return (
    <div className="vc-dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="vc-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="vc-dialog-title">
          {DECISION_LABEL[choice]} for {item.personName}?
        </h2>

        <p id={descId} className="vc-dialog-meaning" data-choice={choice}>
          {DECISION_MEANING[choice]}
        </p>

        <p className="vc-dialog-detail">
          Access: <strong>{item.accessName}</strong>
          {item.sourceName && <> in {item.sourceName}</>}
        </p>

        {isReassign && (
          <>
            <label className="vc-dialog-label" htmlFor={`${titleId}-recipient`}>
              Reassign to (required)
            </label>
            {searchApi && (
              <div id={`${titleId}-recipient`}>
                <IdentityPicker
                  searchApi={searchApi}
                  value={recipient}
                  onChange={setRecipient}
                  disabled={submitting}
                />
              </div>
            )}
            {recipient === null && (
              <p className="vc-dialog-hint">
                Choose the person who should review this instead.
              </p>
            )}
          </>
        )}

        <label className="vc-dialog-label" htmlFor={`${titleId}-comment`}>
          {required ? 'Add a reason (required)' : 'Add a reason (optional)'}
        </label>
        <select
          id={`${titleId}-comment`}
          className="vc-dialog-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={submitting}
        >
          {!required && <option value={NO_COMMENT}>No comment</option>}
          {required && selected === '' && (
            <option value="" disabled>
              Choose a reason…
            </option>
          )}
          {suggestions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value={CUSTOM}>Write my own…</option>
        </select>

        {selected === CUSTOM && (
          <textarea
            className="vc-dialog-textarea"
            placeholder="Type your reason…"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            disabled={submitting}
            rows={3}
            aria-label="Your reason"
            autoFocus
          />
        )}

        {required && comment.length === 0 && (
          <p className="vc-dialog-hint">
            This review asks for a reason before you can {DECISION_LABEL[choice].toLowerCase()}.
          </p>
        )}

        <div className="vc-dialog-actions">
          <button
            type="button"
            className="vc-btn vc-btn-secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={
              isReassign
                ? 'vc-btn vc-btn-reassign'
                : choice === 'allow'
                  ? 'vc-btn vc-btn-allow'
                  : 'vc-btn vc-btn-deny'
            }
            onClick={isReassign ? confirmReassign : () => onConfirm(comment)}
            disabled={!canConfirm}
          >
            {submitting ? 'Saving…' : DECISION_LABEL[choice]}
          </button>
        </div>
      </div>
    </div>
  )
}
