/**
 * Coordinates the allow/remove decision flow: which item's dialog is open, the
 * submit (optimistic local update → API call → refresh campaign progress), and
 * rollback + a friendly message when the API call fails.
 */
import { useCallback, useState } from 'react'
import {
  FriendlyError,
  decide,
  reassignReviewItem,
} from '../sailpoint/certifications'
import type { CertificationsApi } from 'sailpoint-api-client/certifications/api'
import { reviewStatusOf } from '../domain/metrics'
import { reviewKey } from '../domain/reviewOverlay'
import type { AccessDecisionRequest } from '../graph/accessDecision'
import type { CampaignVM, DecisionChoice, ReviewItemVM } from '../sailpoint/types'
import type { ReviewItemsState } from './useReviewItems'

/** The decision the dialog is currently open for. */
export interface PendingDecision {
  item: ReviewItemVM
  choice: DecisionChoice
}

export interface DecisionsState {
  /** The decision awaiting confirmation, or null when the dialog is closed. */
  pending: PendingDecision | null
  /** True while a confirmed decision is being saved. */
  submitting: boolean
  /** Friendly error from the most recent failed decision, or null. */
  error: string | null
  /** Open the confirmation dialog for an item + choice. */
  open: (item: ReviewItemVM, choice: DecisionChoice) => void
  /** Close the dialog without deciding. */
  cancel: () => void
  /** Dismiss the error banner. */
  clearError: () => void
  /** Confirm the pending decision with a comment ('' when none). */
  confirm: (comment: string) => Promise<void>
  /**
   * Confirm a pending reassignment: hand the item to another person to review,
   * with a required comment. Optimistically marks the item reassigned, calls
   * the API, refreshes the campaign, and rolls back on failure.
   */
  confirmReassign: (identityId: string, comment: string) => Promise<void>
  /**
   * Record one approve, revoke, or reassign for every review item behind the
   * access-map selection. The comment (and, for reassign, the recipient)
   * applies to all of them. Throws when nothing can be saved, after rolling
   * back any optimistic update.
   */
  confirmAccess: (request: AccessDecisionRequest) => Promise<void>
}

interface UseDecisionsArgs {
  api: CertificationsApi
  campaignId: string
  review: ReviewItemsState
  /** Called with the campaign returned by the decision, to refresh progress. */
  onCampaignUpdated: (campaign: CampaignVM) => void
}

export function useDecisions({
  api,
  campaignId,
  review,
  onCampaignUpdated,
}: UseDecisionsArgs): DecisionsState {
  const [pending, setPending] = useState<PendingDecision | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback((item: ReviewItemVM, choice: DecisionChoice) => {
    setError(null)
    setPending({ item, choice })
  }, [])

  const cancel = useCallback(() => setPending(null), [])
  const clearError = useCallback(() => setError(null), [])

  const confirm = useCallback(
    async (comment: string) => {
      if (!pending) return
      const { item, choice } = pending
      const decision = choice === 'allow' ? 'APPROVE' : 'REVOKE'
      const trimmed = comment.trim()

      setSubmitting(true)
      setError(null)
      // Optimistically reflect the decision so charts/queue update instantly.
      review.applyDecision(item.id, decision, trimmed || null)

      try {
        const updated = await decide(api, campaignId, [
          { itemId: item.id, choice, comment: trimmed || undefined },
        ])
        onCampaignUpdated(updated)
        setPending(null)
      } catch (err) {
        // Roll back and tell the user plainly what happened.
        review.revertDecision(item.id)
        setError(
          err instanceof FriendlyError
            ? err.message
            : "We couldn't save that decision. Please try again.",
        )
      } finally {
        setSubmitting(false)
      }
    },
    [api, campaignId, pending, review, onCampaignUpdated],
  )

  const confirmReassign = useCallback(
    async (identityId: string, comment: string) => {
      if (!pending) return
      const { item } = pending
      const trimmed = comment.trim()

      setSubmitting(true)
      setError(null)
      // Optimistically mark it reassigned so the queue/charts update instantly.
      review.applyReassign(item.id, trimmed || null)

      try {
        const updated = await reassignReviewItem(api, {
          certificationId: campaignId,
          itemId: item.id,
          reassignToId: identityId,
          reason: trimmed,
        })
        onCampaignUpdated(updated)
        setPending(null)
      } catch (err) {
        // Roll back and surface the same friendly message as keep/remove.
        review.revertDecision(item.id)
        setError(
          err instanceof FriendlyError
            ? err.message
            : "We couldn't save that decision. Please try again.",
        )
      } finally {
        setSubmitting(false)
      }
    },
    [api, campaignId, pending, review, onCampaignUpdated],
  )

  const confirmAccess = useCallback(
    async (request: AccessDecisionRequest) => {
      const keys = new Set(request.reviewKeys)
      const targets = (review.items ?? []).filter((item) => {
        if (item.accessKind === 'access') return false
        if (reviewStatusOf(item) !== 'needsReview') return false
        return keys.has(
          reviewKey(item.identityId, item.accessKind, item.accessId, item.accessName),
        )
      })
      const fail = (message: string): never => {
        setError(message)
        throw new FriendlyError(message)
      }
      if (targets.length === 0) {
        fail('Those items no longer need a decision.')
      }
      if (request.action === 'revoke' && targets.some((item) => !item.revocable)) {
        fail("One or more of these items can't be revoked from here.")
      }

      const trimmed = request.comment.trim()
      const comment = trimmed || null
      if (request.action === 'reassign' && (!request.reassignToId || !trimmed)) {
        fail('Choose a person and a reason before reassigning.')
      }

      setSubmitting(true)
      setError(null)
      const revert = () => {
        for (const item of targets) review.revertDecision(item.id)
      }

      try {
        if (request.action === 'reassign') {
          for (const item of targets) review.applyReassign(item.id, comment)
          const updated = await reassignReviewItem(api, {
            certificationId: campaignId,
            itemId: targets[0].id,
            itemIds: targets.map((item) => item.id),
            reassignToId: request.reassignToId ?? '',
            reason: trimmed,
          })
          onCampaignUpdated(updated)
          return
        }

        const choice = request.action === 'approve' ? 'allow' : 'remove'
        const decision = choice === 'allow' ? 'APPROVE' : 'REVOKE'
        for (const item of targets) review.applyDecision(item.id, decision, comment)
        const updated = await decide(
          api,
          campaignId,
          targets.map((item) => ({
            itemId: item.id,
            choice,
            comment: trimmed || undefined,
            bulk: targets.length > 1,
          })),
        )
        onCampaignUpdated(updated)
      } catch (err) {
        revert()
        const message =
          err instanceof FriendlyError
            ? err.message
            : "We couldn't save that decision. Please try again."
        setError(message)
        throw err instanceof FriendlyError ? err : new FriendlyError(message)
      } finally {
        setSubmitting(false)
      }
    },
    [api, campaignId, review, onCampaignUpdated],
  )

  return {
    pending,
    submitting,
    error,
    open,
    cancel,
    clearError,
    confirm,
    confirmReassign,
    confirmAccess,
  }
}
