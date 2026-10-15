/**
 * Loads every access review item for a campaign and orders them by the
 * client-side priority model (the API cannot sort by risk). Exposes the ordered
 * items, whether any risk signals were found, loading/error state, a `reload`,
 * and an `applyDecision` that updates one item in place so the UI reflects a
 * decision instantly without re-fetching the whole list.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FriendlyError, listReviewItems } from '../sailpoint/certifications'
import { hasNoRiskSignals, prioritize } from '../domain/priority'
import type { PrioritizedItem } from '../domain/priority'
import type { CertificationsApi } from 'sailpoint-api-client/certifications/api'
import type { CertificationDecision } from 'sailpoint-api-client/certifications/api'
import type { ReviewItemVM } from '../sailpoint/types'

interface State {
  loading: boolean
  items: ReviewItemVM[] | null
  error: string | null
}

export interface ReviewItemsState {
  loading: boolean
  error: string | null
  /** Raw items (unordered), or null before load. */
  items: ReviewItemVM[] | null
  /** Items ordered highest-priority first. */
  ordered: PrioritizedItem[]
  /** True when the campaign exposed no risk signals (order is alphabetical). */
  noRiskSignals: boolean
  reload: () => void
  /** Record a decision on one item locally (optimistic update). */
  applyDecision: (
    itemId: string,
    decision: CertificationDecision,
    comments: string | null,
  ) => void
  /**
   * Record a reassignment on one item locally (optimistic update). Marks the
   * item resolved by reassignment — a third outcome distinct from the
   * APPROVE/REVOKE set by applyDecision, so it carries no `decision`.
   */
  applyReassign: (itemId: string, comments: string | null) => void
  /** Revert an item to undecided (used when an API call fails). */
  revertDecision: (itemId: string) => void
}

export function useReviewItems(
  api: CertificationsApi,
  campaignId: string,
): ReviewItemsState {
  const [state, setState] = useState<State>({
    loading: true,
    items: null,
    error: null,
  })
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setState((s) => ({ ...s, loading: true, error: null }))
      try {
        const items = await listReviewItems(api, campaignId)
        if (!cancelled) setState({ loading: false, items, error: null })
      } catch (err) {
        if (cancelled) return
        setState({
          loading: false,
          items: null,
          error:
            err instanceof FriendlyError
              ? err.message
              : 'Something went wrong loading the items to review.',
        })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [api, campaignId, nonce])

  const applyDecision = useCallback(
    (itemId: string, decision: CertificationDecision, comments: string | null) => {
      setState((s) =>
        s.items
          ? {
              ...s,
              items: s.items.map((item) =>
                item.id === itemId
                  ? { ...item, completed: true, decision, comments }
                  : item,
              ),
            }
          : s,
      )
    },
    [],
  )

  const applyReassign = useCallback(
    (itemId: string, comments: string | null) => {
      setState((s) =>
        s.items
          ? {
              ...s,
              items: s.items.map((item) =>
                item.id === itemId
                  ? { ...item, completed: true, reassigned: true, comments }
                  : item,
              ),
            }
          : s,
      )
    },
    [],
  )

  const revertDecision = useCallback((itemId: string) => {
    setState((s) =>
      s.items
        ? {
            ...s,
            items: s.items.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    completed: false,
                    decision: null,
                    reassigned: false,
                    comments: null,
                  }
                : item,
            ),
          }
        : s,
    )
  }, [])

  // Re-prioritize whenever the items change. Memoized so decisions don't
  // reshuffle the list mid-review (completed items sink but keep their slot
  // relative to other completed items).
  const ordered = useMemo(
    () => (state.items ? prioritize(state.items) : []),
    [state.items],
  )
  const noRiskSignals = useMemo(
    () => ordered.length > 0 && hasNoRiskSignals(ordered),
    [ordered],
  )

  return {
    loading: state.loading,
    error: state.error,
    items: state.items,
    ordered,
    noRiskSignals,
    reload,
    applyDecision,
    applyReassign,
    revertDecision,
  }
}
