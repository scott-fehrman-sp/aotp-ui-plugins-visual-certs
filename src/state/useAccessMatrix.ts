/**
 * Resolves the access expansion matrix for a campaign's review items.
 *
 * Mirrors `useProvenance`'s lifecycle conventions: a resolver held in a `useRef`
 * recreated only on campaign change (fresh per-id cache), the resolve effect
 * keyed on a STABLE id-set signature (not the array reference) so a
 * decision-driven `items` rebuild does not re-run resolution, and a `cancelled`
 * guard that drops a stale resolution.
 *
 * Unlike provenance (a non-blocking per-item enhancement), the matrix is the
 * PRIMARY content of its own screen, so the hook exposes a single-shot
 * `status` the view gates on. Soft-degraded leaves never fail the matrix; they
 * surface as `unresolvedCount` for a non-fatal banner. `status:'error'` is
 * reserved for a truly fatal thrown error.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AccessProfilesApi } from 'sailpoint-api-client/access_profiles/api'
import type { EntitlementsApi } from 'sailpoint-api-client/entitlements/api'
import type { RolesApi } from 'sailpoint-api-client/roles/api'
import { deriveAccessGraph } from '../domain/accessGraph'
import {
  createAccessCompositionResolver,
  resolveMatrix,
} from '../sailpoint/accessMatrix'
import type { AccessCompositionResolver } from '../sailpoint/accessMatrix'
import { toFriendlyError } from '../sailpoint/certifications'
import type {
  AccessGraphData,
  AccessMatrixRowVM,
  ReviewItemVM,
} from '../sailpoint/types'

export interface AccessMatrixState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  rows: AccessMatrixRowVM[]
  graph: AccessGraphData
  /** Count of rows that soft-degraded (unresolved), for a non-fatal banner. */
  unresolvedCount: number
  error: string | null
  reload: () => void
}

const EMPTY_GRAPH: AccessGraphData = { nodes: [], edges: [] }

export function useAccessMatrix(
  rolesApi: RolesApi,
  accessProfilesApi: AccessProfilesApi,
  entitlementsApi: EntitlementsApi,
  campaignId: string,
  items: ReviewItemVM[] | null,
): AccessMatrixState {
  const [status, setStatus] = useState<AccessMatrixState['status']>('idle')
  const [rows, setRows] = useState<AccessMatrixRowVM[]>([])
  const [graph, setGraph] = useState<AccessGraphData>(EMPTY_GRAPH)
  const [error, setError] = useState<string | null>(null)

  // The resolver's per-id caches survive re-renders; `CampaignRoute` is keyless,
  // so a campaign switch re-renders the same instance. Recreate the resolver
  // when the campaign changes (tracked synchronously by `resolverCampaignRef`).
  const resolverRef = useRef<AccessCompositionResolver | null>(null)
  const resolverCampaignRef = useRef<string | null>(null)

  // A monotonic token to force a re-resolve on `reload()`.
  const [reloadToken, setReloadToken] = useState(0)

  // Key the effect on a STABLE id signature, not the array reference, so a
  // decision-driven `items` rebuild (same ids) does not re-run resolution.
  const idSig = useMemo(
    () => (items ?? []).map((i) => i.id).join('|'),
    [items],
  )

  useEffect(() => {
    const freshCampaign = resolverCampaignRef.current !== campaignId
    if (resolverRef.current === null || freshCampaign) {
      resolverRef.current = createAccessCompositionResolver(
        rolesApi,
        accessProfilesApi,
        entitlementsApi,
      )
      resolverCampaignRef.current = campaignId
    }
    const resolver = resolverRef.current

    if (!items) {
      // Items not loaded yet upstream: reset to idle so a campaign change does
      // not leave stale rows on screen. This is an intentional synchronous
      // reset (mirrors how `useProvenance` seeds its map synchronously before
      // the async resolve); the functional updater keeps it a no-op once idle.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus((s) => (s === 'idle' ? s : 'idle'))
      return
    }

    let cancelled = false
    setStatus('loading')
    setError(null)

    resolveMatrix(items, resolver)
      .then((resolvedRows) => {
        if (cancelled) return
        setRows(resolvedRows)
        setGraph(deriveAccessGraph(resolvedRows))
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // resolveMatrix soft-degrades API failures to unresolved rows, so this
        // path is reserved for a truly fatal/unexpected error.
        setRows([])
        setGraph(EMPTY_GRAPH)
        setError(toFriendlyError(err).message)
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
    // Intentionally keyed on the id signature + campaign + reload token, NOT the
    // `items` array reference (a decision rebuilds the array but preserves ids).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSig, campaignId, reloadToken])

  const unresolvedCount = useMemo(
    () => rows.filter((r) => r.unresolved).length,
    [rows],
  )

  const reload = useCallback(() => setReloadToken((t) => t + 1), [])

  return { status, rows, graph, unresolvedCount, error, reload }
}
