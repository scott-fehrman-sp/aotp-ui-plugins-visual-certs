/**
 * Resolves per-item provenance lazily, AFTER `useReviewItems` has loaded the
 * list, so provenance never blocks or slows the review queue. One fetch per
 * identity (via the resolver's promise cache) is reused across all that
 * identity's items; keep/remove/reassign never re-fetch or flash loading.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AccessRequestsApi } from 'sailpoint-api-client/access_requests/api'
import type { IdentityHistoryApi } from 'sailpoint-api-client/identity_history/api'
import {
  createProvenanceResolver,
  toProvenanceVM,
} from '../sailpoint/provenance'
import type { ProvenanceResolver } from '../sailpoint/provenance'
import type { ProvenanceEntry, ReviewItemVM } from '../sailpoint/types'

export interface ProvenanceState {
  /** Per-item provenance keyed by review item id. */
  byItemId: Record<string, ProvenanceEntry>
}

export function useProvenance(
  accessRequestsApi: AccessRequestsApi,
  identityHistoryApi: IdentityHistoryApi,
  campaignId: string,
  items: ReviewItemVM[] | null,
): ProvenanceState {
  const [byItemId, setByItemId] = useState<Record<string, ProvenanceEntry>>({})

  // The resolver's per-identity promise cache survives re-renders. It is NOT
  // reset on unmount: `CampaignRoute` is keyless, so a campaign switch
  // re-renders the same instance rather than remounting. We recreate the
  // resolver when the campaign changes, tracked by `resolverCampaignRef` so the
  // single effect below can do it synchronously (no setState in the effect
  // body, which would risk cascading renders).
  const resolverRef = useRef<ProvenanceResolver | null>(null)
  const resolverCampaignRef = useRef<string | null>(null)

  // Key the resolve effect on a STABLE id-set signature, not the array
  // reference. `applyDecision`/`applyReassign`/`revertDecision` build a new
  // `items` array on every decision but preserve every id, so this signature is
  // unchanged by a decision — the effect does not re-run and no entry flashes
  // back to `loading`. It re-runs only when the id set changes (campaign
  // change / reload) or the campaign changes.
  const idSig = useMemo(
    () => (items ?? []).map((i) => i.id).join('|'),
    [items],
  )

  useEffect(() => {
    // Recreate the resolver (fresh per-identity cache) the first time we see a
    // new campaign, so no identity shared between campaigns returns a stale
    // promise. Done synchronously here — not via setState in a separate effect.
    const freshCampaign = resolverCampaignRef.current !== campaignId
    if (resolverRef.current === null || freshCampaign) {
      resolverRef.current = createProvenanceResolver(
        accessRequestsApi,
        identityHistoryApi,
      )
      resolverCampaignRef.current = campaignId
    }
    const resolver = resolverRef.current

    if (!items || items.length === 0) {
      // Drop entries from a previous campaign when the new one has no items.
      if (freshCampaign) setByItemId({})
      return
    }

    let cancelled = false

    // Seed per-item state: on a campaign change start from an empty map so
    // stale entries do not linger; otherwise keep what we have. Items with no
    // identity can never resolve to a VM and are marked unavailable. A ready
    // entry is never downgraded back to loading.
    setByItemId((prev) => {
      const next: Record<string, ProvenanceEntry> = freshCampaign ? {} : { ...prev }
      for (const item of items) {
        if (!item.identityId) {
          next[item.id] = { status: 'unavailable', data: null }
        } else if (next[item.id]?.status !== 'ready') {
          next[item.id] = { status: 'loading', data: null }
        }
      }
      return next
    })

    // Group items by identity so we call the resolver once per identity.
    const byIdentity = new Map<string, ReviewItemVM[]>()
    for (const item of items) {
      if (!item.identityId) continue
      const group = byIdentity.get(item.identityId) ?? []
      group.push(item)
      byIdentity.set(item.identityId, group)
    }

    for (const [identityId, group] of byIdentity) {
      void resolver.forIdentity(identityId).then((raw) => {
        if (cancelled) return
        setByItemId((prev) => {
          const next = { ...prev }
          for (const item of group) {
            next[item.id] = {
              // The only hard-failure path to `unavailable`.
              status: raw.requestsFailedHard ? 'unavailable' : 'ready',
              data: raw.requestsFailedHard ? null : toProvenanceVM(item, raw),
            }
          }
          return next
        })
      })
    }

    return () => {
      cancelled = true
    }
    // `idSig` captures the id set and `campaignId` captures a campaign switch.
    // We intentionally do NOT depend on the `items` array reference: a
    // keep/remove/reassign rebuilds the array but preserves ids, so neither key
    // changes and the effect does not re-run or flash loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSig, campaignId])

  return { byItemId }
}
