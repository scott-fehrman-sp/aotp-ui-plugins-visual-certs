/**
 * Builds the overview's access graph, and lazily resolves one user's full
 * composition at a time.
 *
 * The overview graph (`graph`, below) is built from `shallowRow` — the user
 * and each review item's own directly-held kind/id/name, nothing more — so it
 * costs ZERO role / access-profile / entitlement / source API calls no matter
 * how many users or items a campaign has. Those four APIs are only ever called
 * through `resolveUser`, which this hook exposes and nothing calls
 * automatically: the host view wires it to "a user is selected for
 * processing" (drilling into them on the access map).
 *
 * Identity detail is the exception, and it is deliberate: every distinct user
 * is looked up as soon as the review items are in hand (`identities`, below)
 * so the grid cards are complete enough to choose who to review. That lookup
 * goes through the session-long resolver cache, so selecting the user later
 * does not fetch the identity again.
 *
 * `resolver` is NOT created here: it is the single, session-long
 * `PluginRuntime.accessCompositionResolver` (see `sailpoint/sdkClient.ts`),
 * threaded in by the caller. Its per-id caches therefore persist across every
 * user AND every campaign for the whole session — exactly the "retain caching
 * ... across many users, and across many certifications" requirement this
 * hook exists to satisfy. This hook's own state (`userDetails`) is per-campaign
 * only (reset on a campaign switch, since a prior campaign's resolved users
 * have no bearing on a new one's grid), but the underlying API data they were
 * built from remains cached on `resolver` regardless.
 *
 * Review STATUS is a live overlay: the shallow-graph effect builds only the
 * structural graph, and `graph` is a `useMemo` that applies the CURRENT items'
 * statuses to it, so a keep/remove/reassign decision updates the graph without
 * rebuilding it — mirroring how the old eager hook treated the (far more
 * expensive) deep graph. `userDetails[id].graph` is a deep per-user graph, not
 * run back through `applyReviewStatus`: each row's resolveMatrix output never
 * carries live status (see `resolveMatrix`'s doc). The canvas copies the live
 * status from this hook's shallow `graph` onto that deep graph when the user
 * is drilled into (`copyFirstLevelStatus`), so a decision never re-resolves.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { deriveAccessGraph } from '../domain/accessGraph'
import { applyReviewStatus } from '../domain/reviewOverlay'
import { resolveMatrix, shallowRow } from '../sailpoint/accessMatrix'
import type { AccessCompositionResolver } from '../sailpoint/accessMatrix'
import { toFriendlyError } from '../sailpoint/certifications'
import type { ResolvedIdentity } from '../sailpoint/identities'
import type { AccessGraphData, ReviewItemVM } from '../sailpoint/types'

/**
 * One user's lazily-resolved composition. Keyed by the user's bare identity id
 * (not the namespaced `user:<id>` graph node id) in `AccessMatrixState.userDetails`.
 */
export interface UserDetailState {
  userId: string
  status: 'loading' | 'ready' | 'error'
  /** This user's fully-expanded graph. `EMPTY_GRAPH` while loading or on error. */
  graph: AccessGraphData
  /** Count of this user's rows that soft-degraded, for a non-fatal, per-user banner. */
  unresolvedCount: number
  error: string | null
  /**
   * This user's identity, stored as soon as that one lookup returns — before
   * the role / access-profile / entitlement / source composition in `graph`
   * is ready. The user card reads it for the manager mark and the detail
   * panel, so those do not wait on the rest of the composition.
   */
  identity?: ResolvedIdentity
}

export interface AccessMatrixState {
  /** `'idle'` until `items` has loaded upstream; `'ready'` once the (always
   * synchronous, API-free) overview graph has been built from it. */
  status: 'idle' | 'ready'
  /**
   * The all-users overview graph: a `user` node per reviewer plus, for each
   * review item, the role / access profile / entitlement it directly holds —
   * built from `shallowRow`, so composing it never calls the role /
   * access-profile / entitlement / source APIs.
   */
  graph: AccessGraphData
  /**
   * Each user `resolveUser` has been called for, keyed by bare identity id.
   * Empty until a user is selected for processing; a user never requested has
   * no entry (not a `'loading'` one).
   */
  userDetails: Record<string, UserDetailState>
  /**
   * Resolves one user's full composition (calls the role / access-profile /
   * entitlement / source APIs for exactly that user's items) and records the
   * result in `userDetails`. A second call while that user is `'loading'` or
   * already `'ready'` is a no-op; a call for a user whose last attempt
   * `'error'`-ed retries.
   */
  resolveUser: (userId: string) => void
  /**
   * Identity detail for every user in the current review, keyed by bare
   * identity id. Filled as each lookup returns (cached on the session-long
   * resolver). Empty until the review items have loaded.
   */
  identities: Record<string, ResolvedIdentity>
}

/** How many identity lookups run at once while filling the user grid. */
const IDENTITY_PREFETCH_CONCURRENCY = 6

const EMPTY_GRAPH: AccessGraphData = { nodes: [], edges: [] }

export function useAccessMatrix(
  resolver: AccessCompositionResolver,
  campaignId: string,
  items: ReviewItemVM[] | null,
): AccessMatrixState {
  // Structural overview graph only (no review status); the live overlay is
  // applied below. Built synchronously (no API calls), but still held in
  // state rather than derived inline so `deriveAccessGraph`'s own node/edge
  // objects — not just this hook's render — keep a stable reference across a
  // status-only `items` change (see the `idSig` key below).
  const [structural, setStructural] = useState<AccessGraphData>(EMPTY_GRAPH)

  // Key the shallow-graph rebuild on a STABLE id signature, not the array
  // reference, so a decision-driven `items` rebuild (same ids, new array) does
  // not rebuild `structural` — preserving the `graph.nodes` reference
  // `AccessGraphCanvas` relies on to tell a status-only change from a
  // structural one.
  const idSig = useMemo(
    () => (items ?? []).map((i) => i.id).join('|'),
    [items],
  )

  useEffect(() => {
    // Synchronous and API-free (just `deriveAccessGraph` over `shallowRow`s),
    // so there is no async boundary to move this past; see `useProvenance`'s
    // and the prior version of this hook's identical, already-reviewed use of
    // this pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStructural(items ? deriveAccessGraph(items.map(shallowRow)) : EMPTY_GRAPH)
    // Intentionally keyed on the id signature, NOT the `items` array reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSig])

  const graph = useMemo(
    () => applyReviewStatus(structural, items ?? []),
    [structural, items],
  )

  const [userDetails, setUserDetails] = useState<Record<string, UserDetailState>>({})
  const [identities, setIdentities] = useState<Record<string, ResolvedIdentity>>({})

  // Every distinct user, looked up once the review items are known. The grid
  // cards need this before anyone is selected. `resolver.identity` is cached
  // for the session, so a later `resolveUser` for the same person does not
  // hit the network again. A bounded pool keeps a large review from bursting
  // the identities API.
  const identityIdSig = useMemo(() => {
    const ids = new Set<string>()
    for (const item of items ?? []) {
      if (item.identityId) ids.add(item.identityId)
    }
    return [...ids].sort().join('|')
  }, [items])

  useEffect(() => {
    const ids = identityIdSig ? identityIdSig.split('|') : []
    if (ids.length === 0) return
    let cancelled = false
    const queue = [...ids]
    const workers = Math.min(IDENTITY_PREFETCH_CONCURRENCY, queue.length)
    const run = async () => {
      while (!cancelled) {
        const id = queue.shift()
        if (!id) return
        try {
          const identity = await resolver.identity(id)
          if (cancelled) return
          setIdentities((prev) => (prev[id] ? prev : { ...prev, [id]: identity }))
        } catch {
          // `identity` soft-degrades instead of throwing. A failure here just
          // leaves that card on the review-item name until a later attempt.
        }
      }
    }
    void Promise.all(Array.from({ length: workers }, () => run()))
    return () => {
      cancelled = true
    }
  }, [identityIdSig, resolver])

  // A campaign switch drops every previously-resolved user: a prior campaign's
  // resolved ids may not even exist in the new one, and nothing should show a
  // stale user's composition over a new campaign's grid. This does NOT touch
  // `resolver`'s own per-id caches — those live on the long-lived resolver
  // instance threaded in from `PluginRuntime`, outside this hook, and persist
  // across the reset. Tracking the prior campaign id in STATE and adjusting
  // during render (rather than a ref, or an effect) is React's documented
  // pattern for resetting state on a prop change — see `prevNodes` in
  // `AccessGraphCanvas` for the same pattern.
  const [prevCampaignId, setPrevCampaignId] = useState(campaignId)
  if (prevCampaignId !== campaignId) {
    setPrevCampaignId(campaignId)
    setUserDetails({})
  }

  const resolveUser = useCallback(
    (userId: string) => {
      // A second call for a user already `'loading'` or `'ready'` is a no-op;
      // an `'error'`-ed user (or one never requested) proceeds, so a failure
      // can be retried.
      const existing = userDetails[userId]
      if (existing && existing.status !== 'error') return
      setUserDetails((prev) => ({
        ...prev,
        [userId]: {
          userId,
          status: 'loading',
          graph: EMPTY_GRAPH,
          unresolvedCount: 0,
          error: null,
          // A retry keeps an identity already in hand so the manager mark
          // does not blink off while composition runs again.
          identity: prev[userId]?.identity,
        },
      }))
      // The identity lookup is the same cached call `resolveMatrix` makes per
      // item (no second request). Recording it here lets the user card show
      // the manager mark as soon as this one call returns, instead of waiting
      // until every role / access profile / entitlement / source call finishes.
      void resolver.identity(userId).then(
        (identity) => {
          setUserDetails((prev) => {
            const current = prev[userId]
            if (!current) return prev
            return { ...prev, [userId]: { ...current, identity } }
          })
        },
        () => {
          // `resolveMatrix` reports a fatal identity failure on `status`. This
          // call is only the early card update, so its rejection stops here.
        },
      )
      const userItems = (items ?? []).filter((item) => item.identityId === userId)
      resolveMatrix(userItems, resolver)
        .then((rows) => {
          setUserDetails((prev) => ({
            ...prev,
            [userId]: {
              ...prev[userId],
              userId,
              status: 'ready',
              graph: deriveAccessGraph(rows),
              unresolvedCount: rows.filter((r) => r.unresolved).length,
              error: null,
            },
          }))
        })
        .catch((err: unknown) => {
          // resolveMatrix soft-degrades per-id API failures to unresolved rows,
          // so this path is reserved for a truly fatal/unexpected error.
          setUserDetails((prev) => ({
            ...prev,
            [userId]: {
              ...prev[userId],
              userId,
              status: 'error',
              graph: EMPTY_GRAPH,
              unresolvedCount: 0,
              error: toFriendlyError(err).message,
            },
          }))
        })
    },
    [resolver, items, userDetails],
  )

  return {
    status: items ? 'ready' : 'idle',
    graph,
    userDetails,
    resolveUser,
    identities,
  }
}
