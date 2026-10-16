/**
 * The provenance data layer: resolver (fetch-once-per-identity + cache),
 * matcher (pair a review item to a request row / history event by name + type),
 * and mapper (raw DTOs -> a clean, DTO-free `AccessProvenanceVM`).
 *
 * Like `certifications.ts`, every network call is wrapped so a failure never
 * surfaces a raw DTO or axios/HTTP noise — the resolver swallows per-identity
 * failures and the mapper is pure, so the UI only ever sees view models and
 * honest degraded states. Provenance is strictly a non-blocking enhancement:
 * it must never gate or slow the review queue.
 */
import type { AccessRequestsApi } from 'sailpoint-api-client/access_requests/api'
import type {
  ApprovalStatusDto,
  RequestedItemStatus,
} from 'sailpoint-api-client/access_requests/api'
import type { IdentityHistoryApi } from 'sailpoint-api-client/identity_history/api'
import type { GetHistoricalIdentityEventsV1200ResponseInner } from 'sailpoint-api-client/identity_history/api'
import { toFriendlyError } from './certifications'
import type {
  AccessKind,
  AccessProvenanceVM,
  ApprovalStepVM,
  ReviewItemVM,
} from './types'

/** Alias for a single history event row (the DTO name is a mouthful). */
type HistoricalEvent = GetHistoricalIdentityEventsV1200ResponseInner

/** The raw, per-identity bundle the resolver caches. UI never sees this. */
export interface RawIdentityProvenance {
  /** Access-request rows for the identity ([] on any request failure). */
  requests: RequestedItemStatus[]
  /** History events, or null when history was unavailable (non-load-bearing). */
  events: HistoricalEvent[] | null
  /**
   * True ONLY on a hard request-fetch failure (429 / 5xx / network). This is
   * the single signal the hook uses to decide `unavailable`; a soft 401/403
   * degrade leaves this false.
   */
  requestsFailedHard: boolean
}

/** Fetches (and caches) the raw provenance bundle for one identity. */
export interface ProvenanceResolver {
  forIdentity(identityId: string): Promise<RawIdentityProvenance>
}

/** Page size for the two provenance fetches; the APIs cap limit at 250. */
const PAGE_SIZE = 250

/**
 * Creates a resolver backed by a per-identity promise cache so concurrent
 * calls for one identity dedupe to a single network round-trip, and repeated
 * calls across that identity's items reuse the first result (never N calls per
 * item). The cache lives for the resolver's lifetime; the hook recreates the
 * resolver on campaign change (see `useProvenance`).
 */
export function createProvenanceResolver(
  accessRequestsApi: AccessRequestsApi,
  identityHistoryApi: IdentityHistoryApi,
): ProvenanceResolver {
  const cache = new Map<string, Promise<RawIdentityProvenance>>()

  const fetchRequests = async (
    identityId: string,
  ): Promise<{ rows: RequestedItemStatus[]; failedHard: boolean }> => {
    try {
      const res = await accessRequestsApi.listAccessRequestStatusV1({
        requestedFor: identityId,
        limit: PAGE_SIZE,
      })
      return { rows: res.data ?? [], failedHard: false }
    } catch (error) {
      // Classify via the shared humanizer. A 401/403 (reviewer not authorized
      // to see requests) is a soft degrade; 429/5xx/network is a hard failure
      // that drives the item to `unavailable`.
      const status = toFriendlyError(error).status
      const hard = status === 429 || status === undefined || status >= 500
      return { rows: [], failedHard: hard }
    }
  }

  const fetchHistory = async (
    identityId: string,
  ): Promise<HistoricalEvent[] | null> => {
    try {
      // Passing `xSailPointExperimental: 'true'` is sufficient — the client
      // always writes the `X-SailPoint-Experimental` header for this call. The
      // `eventTypes` filter is a hint only; the matcher does not depend on the
      // exact literal (see the design's open assumption #1).
      const res = await identityHistoryApi.getHistoricalIdentityEventsV1({
        id: identityId,
        eventTypes: ['AccessAddedEvent'],
        accessItemTypes: ['entitlement', 'role', 'accessProfile'],
        limit: PAGE_SIZE,
        xSailPointExperimental: 'true',
      })
      return res.data ?? []
    } catch {
      // History is a non-load-bearing enhancement: any failure (400/403/5xx/
      // network) degrades to null and the mapper falls back to request-only.
      return null
    }
  }

  const load = async (identityId: string): Promise<RawIdentityProvenance> => {
    // Both fetches run in parallel, each with its own catch (above) so one
    // failing never sinks the other.
    const [requests, events] = await Promise.all([
      fetchRequests(identityId),
      fetchHistory(identityId),
    ])
    return {
      requests: requests.rows,
      events,
      requestsFailedHard: requests.failedHard,
    }
  }

  return {
    forIdentity(identityId: string): Promise<RawIdentityProvenance> {
      const cached = cache.get(identityId)
      if (cached) return cached
      const promise = load(identityId)
      cache.set(identityId, promise)
      return promise
    },
  }
}

// --- matcher ----------------------------------------------------------------

/** Maps a review item's access kind to the request/history type token. */
function kindToRequestType(kind: AccessKind): string | null {
  switch (kind) {
    case 'entitlement':
      return 'ENTITLEMENT'
    case 'role':
      return 'ROLE'
    case 'accessProfile':
      return 'ACCESS_PROFILE'
    default:
      return null // 'access' fallback -> match on name only
  }
}

/** Maps a review item's access kind to the history `accessItemType` token. */
function kindToHistoryType(kind: AccessKind): string | null {
  switch (kind) {
    case 'entitlement':
      return 'entitlement'
    case 'role':
      return 'role'
    case 'accessProfile':
      return 'accessProfile'
    default:
      return null
  }
}

/** Case-insensitive, trimmed name comparison. */
function nameEquals(a: string | null | undefined, b: string): boolean {
  if (a == null) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * True when the item's name is unusable for the name-only `access` fallback:
 * the `describeAccess` sentinel `"this access"` or an empty/whitespace name.
 * Such items must NOT match a request row (even one literally named
 * "this access") and resolve via history or honestly to `unknown`.
 */
function isUnmatchableFallbackName(accessName: string): boolean {
  const trimmed = accessName.trim()
  return trimmed === '' || trimmed.toLowerCase() === 'this access'
}

/**
 * Finds the request row matching a review item by name + type. Typed items
 * (entitlement / role / accessProfile) require both name AND the mapped type
 * token (a null-type row never matches them). The `access` fallback matches on
 * name only, and is skipped entirely for the sentinel/empty names above. On a
 * multi-match, the most recently `created` row wins.
 */
export function matchRequest(
  item: ReviewItemVM,
  requests: RequestedItemStatus[],
): RequestedItemStatus | null {
  const typeToken = kindToRequestType(item.accessKind)

  if (typeToken === null) {
    // 'access' fallback: name-only, but guard the sentinel/empty names.
    if (isUnmatchableFallbackName(item.accessName)) return null
    const matches = requests.filter((r) => nameEquals(r.name, item.accessName))
    return mostRecent(matches)
  }

  const matches = requests.filter(
    (r) => nameEquals(r.name, item.accessName) && r.type === typeToken,
  )
  return mostRecent(matches)
}

/** Returns the row with the most recent `created`, or null when none. */
function mostRecent(rows: RequestedItemStatus[]): RequestedItemStatus | null {
  if (rows.length === 0) return null
  return rows.reduce((best, row) => {
    const bestTime = Date.parse(best.created ?? '')
    const rowTime = Date.parse(row.created ?? '')
    // NaN (missing/invalid date) sorts as oldest; keep `best` in that case.
    if (Number.isNaN(rowTime)) return best
    if (Number.isNaN(bestTime)) return row
    return rowTime > bestTime ? row : best
  })
}

/**
 * Finds the access-added history event matching a review item by name + type.
 * Guards `accessItem.displayName` (missing -> non-matching); `accessItem` itself
 * is required by contract. A name/displayName mismatch is an accepted degrade.
 */
export function matchHistoryEvent(
  item: ReviewItemVM,
  events: HistoricalEvent[] | null,
): HistoricalEvent | null {
  if (!events) return null
  const typeToken = kindToHistoryType(item.accessKind)
  if (typeToken === null && isUnmatchableFallbackName(item.accessName)) {
    return null
  }
  return (
    events.find((e) => {
      if (!nameEquals(e.accessItem?.displayName, item.accessName)) return false
      // 'access' fallback matches on name only; typed items also check type.
      return typeToken === null || e.accessItemType === typeToken
    }) ?? null
  )
}

// --- mapper -----------------------------------------------------------------

/** Maps the full `ManualWorkItemState` enum to a plain decision. */
function toDecision(
  status: ApprovalStatusDto['status'],
): ApprovalStepVM['decision'] {
  switch (status) {
    case 'APPROVED':
      return 'approved'
    case 'REJECTED':
      return 'rejected'
    case 'PENDING':
      return 'pending'
    // EXPIRED / CANCELLED / ARCHIVED / undefined / unrecognized -> unknown.
    default:
      return 'unknown'
  }
}

/** Builds the approval chain (oldest first — the array order) from a request. */
function toApprovals(request: RequestedItemStatus): ApprovalStepVM[] {
  return (request.approvalDetails ?? []).map((a) => ({
    approver: a.currentOwner?.name ?? null,
    decision: toDecision(a.status),
    decidedOn: a.modified ?? null,
    comment: a.comment ?? null,
  }))
}

/**
 * Turns the matched raw DTOs for one item into a clean `AccessProvenanceVM`.
 * Pure (no I/O) and never returns or logs a raw DTO. Decision order encodes the
 * single provenance story and never fabricates a mechanism.
 */
export function toProvenanceVM(
  item: ReviewItemVM,
  raw: RawIdentityProvenance,
): AccessProvenanceVM {
  const base: AccessProvenanceVM = {
    itemId: item.id,
    grantMechanism: 'unknown',
    mechanismLabel: 'Granted outside an access request',
    request: null,
    approvals: [],
    grantedOn: null,
    historyUnavailable: raw.events === null,
  }

  // 1. The item under review IS itself a role -> role access, no history needed.
  if (item.accessKind === 'role') {
    return { ...base, grantMechanism: 'role', mechanismLabel: 'Part of a role' }
  }

  // 2. A matching request row is the strongest signal for request access.
  const request = matchRequest(item, raw.requests)
  if (request) {
    return {
      ...base,
      grantMechanism: 'request',
      mechanismLabel: 'Via access request',
      request: {
        requestedBy: request.requester?.name ?? null,
        requestedOn: request.created ?? null,
        justification: request.requesterComment?.comment ?? null,
      },
      approvals: toApprovals(request),
    }
  }

  // 3. No request row, but a matching access-added history event exists. This
  //    branch is request-vs-direct only — history cannot say "via a role".
  const event = matchHistoryEvent(item, raw.events)
  if (event) {
    const grantedOn = event.dateTime ?? null
    // `accessRequest` is always present as an object; test a POPULATED
    // sub-field, not the object itself (a bare `if (event.accessRequest)` is
    // always true and would mislabel direct grants as requests).
    const hasRequestSignal =
      event.governanceEvent?.type === 'accessRequest' ||
      Boolean(
        event.accessRequest?.requesterId ?? event.accessRequest?.requesterName,
      )
    if (hasRequestSignal) {
      return {
        ...base,
        grantMechanism: 'request',
        mechanismLabel: 'Via access request',
        // History carries no approval chain, so approvals stay empty.
        request: {
          requestedBy: event.accessRequest?.requesterName ?? null,
          requestedOn: null,
          justification: null,
        },
        grantedOn,
      }
    }
    return {
      ...base,
      grantMechanism: 'direct',
      mechanismLabel: 'Assigned directly',
      grantedOn,
    }
  }

  // 4. Nothing conclusive -> honest `unknown` (base), with `historyUnavailable`
  //    already set when history could not be reached.
  return base
}
