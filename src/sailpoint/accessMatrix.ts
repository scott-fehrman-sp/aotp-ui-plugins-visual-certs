/**
 * The access-expansion-matrix data layer: a composition RESOLVER (fetch-once +
 * per-id cache, mirrors `provenance.ts`) and a pure MAPPER that expands review
 * items into normalized matrix rows.
 *
 * Like `provenance.ts`, every network call is wrapped so a per-id failure never
 * sinks the whole matrix: the resolver soft-degrades any failure to `null`, and
 * the mapper emits an `unresolved` row carrying whatever is known rather than
 * dropping the path or surfacing a raw DTO. The row-assembly half is pure and
 * directly unit-testable with stubbed composition — no network.
 */
import type { AccessProfilesApi } from 'sailpoint-api-client/access_profiles/api'
import type { EntitlementsApi } from 'sailpoint-api-client/entitlements/api'
import type { RolesApi } from 'sailpoint-api-client/roles/api'
import type { SearchApi } from 'sailpoint-api-client/search/api'
import type { SourcesApi } from 'sailpoint-api-client/sources/api'
import { reviewStatusOf } from '../domain/metrics'
import { fetchIdentityAttributes } from './identities'
import type {
  AccessGraphNodeKind,
  AccessMatrixRowVM,
  AccessReviewStatus,
  ReviewItemVM,
} from './types'

// --- internal, DTO-free resolved shapes (never exposed to components) --------

/** A role's composition: its access profiles + its directly-attached entitlements. */
export interface ResolvedRole {
  id: string
  name: string
  /** Human-readable description for the graph tooltip ('' when absent/null). */
  description: string
  /** Access-profile refs on the role (shallow: id + name only). */
  accessProfileRefs: Array<{ id: string | null; name: string }>
  /** Entitlement refs attached directly to the role (shallow: id + name only). */
  entitlementRefs: Array<{ id: string | null; name: string }>
}

/** An access profile's composition: its entitlement refs (shallow). */
export interface ResolvedAccessProfile {
  id: string
  name: string
  /** Human-readable description for the graph tooltip ('' when absent/null). */
  description: string
  entitlementRefs: Array<{ id: string | null; name: string }>
}

/** A leaf entitlement's name + the source it lives on. */
export interface ResolvedEntitlement {
  id: string
  name: string
  /** Human-readable description for the graph tooltip ('' when absent/null). */
  description: string
  sourceId: string | null
  sourceName: string
  /**
   * The SOURCE's description (not the entitlement's), resolved via the per-id
   * source cache. '' when the source could not be fetched; `sourceName` is kept
   * regardless (soft-degrade).
   */
  sourceDescription: string
}

/**
 * Resolves access composition for the matrix. Each method returns `null` on any
 * failure (soft-degrade) so the mapper can emit an `unresolved` row rather than
 * throwing.
 */
export interface AccessCompositionResolver {
  /** Role body (access profiles + direct entitlements). null = soft-degraded. */
  role(id: string): Promise<ResolvedRole | null>
  /** AP body (entitlement refs). null = soft-degraded. */
  accessProfile(id: string): Promise<ResolvedAccessProfile | null>
  /** Entitlement body (name + source). null = soft-degraded. */
  entitlement(id: string): Promise<ResolvedEntitlement | null>
  /**
   * A source's name + description, for the source-node tooltip. Backed by a
   * per-source-id cache so a source shared by many entitlements is fetched at
   * most once. null = soft-degraded.
   */
  source(id: string): Promise<{ id: string; name: string; description: string } | null>
  /**
   * A user's department + location, for the user-node tooltip. Backed by a
   * per-identity cache (fetch-once, concurrent-dedupe). Soft-degrades to empty
   * strings; returns null only when there is nothing to fetch (empty id).
   */
  identity(id: string): Promise<{ department: string; location: string } | null>
}

/**
 * Creates a resolver backed by THREE independent per-id promise caches (role id,
 * AP id, entitlement id). Concurrent lookups for the same id dedupe to a single
 * round-trip, and every id is fetched at most once regardless of how many users
 * hold it — exactly like `createProvenanceResolver`'s per-identity cache. The
 * cache lives for the resolver's lifetime; the hook recreates the resolver on
 * campaign change.
 *
 * Soft-degrade policy: ANY failure (401/403/404/429/5xx/network) resolves to
 * `null`. Unlike provenance's hard/soft split, the matrix degrades every
 * failure the same way — one bad role must never blank the whole table.
 */
export function createAccessCompositionResolver(
  rolesApi: RolesApi,
  accessProfilesApi: AccessProfilesApi,
  entitlementsApi: EntitlementsApi,
  sourcesApi: SourcesApi,
  searchApi: SearchApi,
): AccessCompositionResolver {
  const roleCache = new Map<string, Promise<ResolvedRole | null>>()
  const apCache = new Map<string, Promise<ResolvedAccessProfile | null>>()
  const entCache = new Map<string, Promise<ResolvedEntitlement | null>>()
  // Per-source-id cache: a source shared by many entitlements is fetched once.
  const sourceCache = new Map<
    string,
    Promise<{ id: string; name: string; description: string } | null>
  >()
  // Per-identity cache for the user department/location lookup.
  const identityCache = new Map<
    string,
    Promise<{ department: string; location: string } | null>
  >()

  const cached = <T>(
    cache: Map<string, Promise<T | null>>,
    id: string,
    load: (id: string) => Promise<T | null>,
  ): Promise<T | null> => {
    // An empty/missing id can never resolve — treat as soft-degraded without a
    // network call.
    if (!id) return Promise.resolve(null)
    const hit = cache.get(id)
    if (hit) return hit
    const promise = load(id)
    cache.set(id, promise)
    return promise
  }

  const fetchSource = async (
    id: string,
  ): Promise<{ id: string; name: string; description: string } | null> => {
    try {
      const res = await sourcesApi.getSourceV1({ id })
      const src = res.data
      return {
        id: src.id ?? id,
        name: src.name ?? '',
        description: src.description ?? '',
      }
    } catch {
      // Soft-degrade: a failed source fetch yields no description, never throws.
      return null
    }
  }

  const source = (id: string) => cached(sourceCache, id, fetchSource)

  const fetchRole = async (id: string): Promise<ResolvedRole | null> => {
    try {
      const res = await rolesApi.getRoleV1({ id })
      const role = res.data
      return {
        id: role.id ?? id,
        name: role.name ?? '',
        description: role.description ?? '',
        accessProfileRefs: (role.accessProfiles ?? []).map((ref) => ({
          id: ref.id ?? null,
          name: ref.name ?? '',
        })),
        entitlementRefs: (role.entitlements ?? []).map((ref) => ({
          id: ref.id ?? null,
          name: ref.name ?? '',
        })),
      }
    } catch {
      // Soft-degrade: a per-id failure must never sink the matrix.
      return null
    }
  }

  const fetchAccessProfile = async (
    id: string,
  ): Promise<ResolvedAccessProfile | null> => {
    try {
      const res = await accessProfilesApi.getAccessProfileV1({ id })
      const ap = res.data
      return {
        id: ap.id ?? id,
        name: ap.name ?? '',
        description: ap.description ?? '',
        entitlementRefs: (ap.entitlements ?? []).map((ref) => ({
          id: ref.id ?? null,
          name: ref.name ?? '',
        })),
      }
    } catch {
      return null
    }
  }

  const fetchEntitlement = async (
    id: string,
  ): Promise<ResolvedEntitlement | null> => {
    try {
      const res = await entitlementsApi.getEntitlementV1({ id })
      const ent = res.data
      const sourceId = ent.source?.id ?? null
      // Route the source description through the per-source-id cache so a source
      // shared by many entitlements is fetched at most once. Keep `sourceName`
      // from the entitlement body regardless of whether the source fetch works.
      const resolvedSource = sourceId ? await source(sourceId) : null
      return {
        id: ent.id ?? id,
        name: ent.name ?? '',
        description: ent.description ?? '',
        sourceId,
        sourceName: ent.source?.name ?? '',
        sourceDescription: resolvedSource?.description ?? '',
      }
    } catch {
      return null
    }
  }

  const fetchIdentity = async (
    id: string,
  ): Promise<{ department: string; location: string } | null> => {
    // fetchIdentityAttributes itself soft-degrades to empty strings (never
    // throws), so this always resolves to a usable object.
    return fetchIdentityAttributes(searchApi, id)
  }

  return {
    role: (id) => cached(roleCache, id, fetchRole),
    accessProfile: (id) => cached(apCache, id, fetchAccessProfile),
    entitlement: (id) => cached(entCache, id, fetchEntitlement),
    source,
    identity: (id) => cached(identityCache, id, fetchIdentity),
  }
}

// --- row assembly (pure given resolved composition) --------------------------

/** The fields that uniquely locate a row for dedup / id purposes. */
interface RowTuple {
  userId: string
  user: string
  role: string
  roleId: string | null
  accessProfile: string
  accessProfileId: string | null
  entitlement: string
  entitlementId: string | null
  source: string
  sourceId: string | null
  unresolved: boolean
  // --- descriptive enrichment (NEVER part of rowKey / dedup identity) --------
  /** User department (per-identity; on every row for the user). */
  userDepartment?: string
  /** User location (per-identity; on every row for the user). */
  userLocation?: string
  /** Resolved role description, when a role is on this path and resolved. */
  roleDescription?: string
  /** Resolved access-profile description, when an AP is on this path. */
  accessProfileDescription?: string
  /** Resolved entitlement description, on a resolved leaf row. */
  entitlementDescription?: string
  /** Resolved SOURCE description, on a resolved leaf row. */
  sourceDescription?: string
  /**
   * Review status of the source review item (via `reviewStatusOf`), on every
   * row the item produces. NEVER part of `rowKey` — same enrichment pattern as
   * `userDepartment`. On a dedup collision the deterministic precedence
   * `needsReview > reassigned > revoked > approved` applies (needsReview never
   * hidden; reassignment terminal over a plain keep/remove decision).
   */
  reviewStatus?: AccessReviewStatus
  /** Kind of the user's directly-held access item (first hop off the user). */
  accessItemKind?: AccessGraphNodeKind
  /** Id of the user's directly-held access item; null when the item had none. */
  accessItemId?: string | null
}

/**
 * Builds the stable, deterministic dedup key / row id from the five-tuple. Uses
 * ids where known so two different entitlements that share a name never merge;
 * falls back to the display name for a slot whose id is null so unresolved rows
 * still dedup sensibly rather than multiplying.
 */
function rowKey(t: RowTuple): string {
  return [
    `u:${t.userId}`,
    `r:${t.roleId ?? `name:${t.role}`}`,
    `a:${t.accessProfileId ?? `name:${t.accessProfile}`}`,
    `e:${t.entitlementId ?? `name:${t.entitlement}`}`,
    `s:${t.sourceId ?? `name:${t.source}`}`,
  ].join('|')
}

/** Resolves one entitlement ref into a leaf tuple fragment (or an unresolved one). */
async function resolveLeaf(
  resolver: AccessCompositionResolver,
  ref: { id: string | null; name: string },
): Promise<{
  entitlement: string
  entitlementId: string | null
  source: string
  sourceId: string | null
  unresolved: boolean
  entitlementDescription?: string
  sourceDescription?: string
}> {
  const resolved = ref.id ? await resolver.entitlement(ref.id) : null
  if (!resolved) {
    // Keep the ref's name/id (known from the parent body) so the row is still
    // meaningful; the source could not be fetched, so mark unresolved.
    return {
      entitlement: ref.name,
      entitlementId: ref.id,
      source: '',
      sourceId: null,
      unresolved: true,
    }
  }
  return {
    entitlement: resolved.name,
    entitlementId: resolved.id,
    source: resolved.sourceName,
    sourceId: resolved.sourceId,
    unresolved: false,
    entitlementDescription: resolved.description,
    sourceDescription: resolved.sourceDescription,
  }
}

/**
 * Expands a single review item into zero-or-more raw row tuples by fetching its
 * composition through the resolver. Pure wrt its inputs aside from the resolver
 * calls (which are cached). Degrades unresolved pieces to `unresolved` tuples
 * rather than throwing.
 */
async function expandItem(
  item: ReviewItemVM,
  resolver: AccessCompositionResolver,
): Promise<RowTuple[]> {
  // Department/location attach to the IDENTITY, independent of the access path,
  // so resolve once per item and fold into `base` — it then lands on EVERY row
  // for this user, including the degenerate all-blank `access` row and any
  // unresolved row. Soft-degrades to '' (never throws, never blanks the matrix).
  const attrs = await resolver.identity(item.identityId)
  // Review status + the directly-held access-item identity attach to the review
  // item itself (independent of how its composition expands), so fold them into
  // `base` and let them land on EVERY row — exactly like department/location.
  // The generic `access` fallback has no composition node, so it carries no
  // access-item kind (its degenerate row still carries status on the user side,
  // but with no access-item node/edge there is nothing to mark downstream).
  const reviewStatus: AccessReviewStatus = reviewStatusOf(item)
  const accessItemKind: AccessGraphNodeKind | undefined =
    item.accessKind === 'role' ||
    item.accessKind === 'accessProfile' ||
    item.accessKind === 'entitlement'
      ? item.accessKind
      : undefined
  const base = {
    userId: item.identityId,
    user: item.personName,
    userDepartment: attrs?.department ?? '',
    userLocation: attrs?.location ?? '',
    reviewStatus,
    accessItemKind,
    accessItemId: item.accessId ?? null,
  }
  // `accessId` is optional on ReviewItemVM; normalize undefined to null.
  const accessId = item.accessId ?? null

  // The generic `access` fallback kind cannot be expanded: there is no
  // role/AP/entitlement id to resolve and no leaf to fetch. Emit exactly one
  // degenerate all-blank-leaf row that degrades honestly.
  if (item.accessKind === 'access') {
    return [
      {
        ...base,
        role: '',
        roleId: null,
        accessProfile: '',
        accessProfileId: null,
        entitlement: '',
        entitlementId: null,
        source: '',
        sourceId: null,
        unresolved: true,
      },
    ]
  }

  if (item.accessKind === 'entitlement') {
    const leaf = await resolveLeaf(resolver, {
      id: accessId,
      name: item.accessName,
    })
    return [
      {
        ...base,
        role: '',
        roleId: null,
        accessProfile: '',
        accessProfileId: null,
        ...leaf,
      },
    ]
  }

  if (item.accessKind === 'accessProfile') {
    const ap = accessId ? await resolver.accessProfile(accessId) : null
    if (!ap) {
      // The AP itself could not be resolved: one unresolved row carrying the
      // AP name under review, blank entitlement/source.
      return [
        {
          ...base,
          role: '',
          roleId: null,
          accessProfile: item.accessName,
          accessProfileId: accessId,
          entitlement: '',
          entitlementId: null,
          source: '',
          sourceId: null,
          unresolved: true,
        },
      ]
    }
    return Promise.all(
      ap.entitlementRefs.map(async (ref) => {
        const leaf = await resolveLeaf(resolver, ref)
        return {
          ...base,
          role: '',
          roleId: null,
          accessProfile: ap.name,
          accessProfileId: ap.id,
          accessProfileDescription: ap.description,
          ...leaf,
        }
      }),
    )
  }

  // accessKind === 'role'
  const role = accessId ? await resolver.role(accessId) : null
  if (!role) {
    return [
      {
        ...base,
        role: item.accessName,
        roleId: accessId,
        accessProfile: '',
        accessProfileId: null,
        entitlement: '',
        entitlementId: null,
        source: '',
        sourceId: null,
        unresolved: true,
      },
    ]
  }

  const rows: RowTuple[] = []

  // (a) For each access profile on the role: one row per entitlement in the AP.
  for (const apRef of role.accessProfileRefs) {
    const ap = apRef.id ? await resolver.accessProfile(apRef.id) : null
    if (!ap) {
      rows.push({
        ...base,
        role: role.name,
        roleId: role.id,
        roleDescription: role.description,
        accessProfile: apRef.name,
        accessProfileId: apRef.id,
        entitlement: '',
        entitlementId: null,
        source: '',
        sourceId: null,
        unresolved: true,
      })
      continue
    }
    for (const ref of ap.entitlementRefs) {
      const leaf = await resolveLeaf(resolver, ref)
      rows.push({
        ...base,
        role: role.name,
        roleId: role.id,
        roleDescription: role.description,
        accessProfile: ap.name,
        accessProfileId: ap.id,
        accessProfileDescription: ap.description,
        ...leaf,
      })
    }
  }

  // (b) For each directly-attached entitlement on the role: one row, blank AP.
  for (const ref of role.entitlementRefs) {
    const leaf = await resolveLeaf(resolver, ref)
    rows.push({
      ...base,
      role: role.name,
      roleId: role.id,
      roleDescription: role.description,
      accessProfile: '',
      accessProfileId: null,
      ...leaf,
    })
  }

  return rows
}

/**
 * Collision precedence for `reviewStatus` when two rows dedup to the same
 * five-id tuple but carry different statuses (highest wins):
 * `needsReview > reassigned > revoked > approved`. needsReview is never hidden;
 * reassignment is terminal over a plain keep/remove decision; the
 * revoked-over-approved order is an arbitrary-but-fixed tiebreak for the
 * defensive decided-vs-decided case. Mirrors `markStatus` in
 * `domain/accessGraph.ts` so the node/edge and the matrix row always agree.
 */
const REVIEW_STATUS_RANK: Record<AccessReviewStatus, number> = {
  needsReview: 3,
  reassigned: 2,
  revoked: 1,
  approved: 0,
}

/**
 * Expands review items into canonical, deduped matrix rows. Async: fetches
 * composition via the resolver (cached, concurrent-deduped). Degrades
 * unresolved leaves to an `unresolved` row rather than throwing.
 *
 * Dedup: one row per distinct `(userId, roleId, accessProfileId, entitlementId,
 * sourceId)` tuple (ids, with a name fallback for null slots). Distinct paths
 * stay distinct; identical paths collapse to one.
 */
export async function resolveMatrix(
  items: ReviewItemVM[],
  resolver: AccessCompositionResolver,
): Promise<AccessMatrixRowVM[]> {
  const expanded = await Promise.all(
    items.map((item) => expandItem(item, resolver)),
  )

  const byKey = new Map<string, AccessMatrixRowVM>()
  for (const tuples of expanded) {
    for (const tuple of tuples) {
      const id = rowKey(tuple)
      const existing = byKey.get(id)
      if (!existing) {
        byKey.set(id, { id, ...tuple })
        continue
      }
      // First-wins on every enrichment field EXCEPT reviewStatus, which follows
      // the four-state precedence on collision via REVIEW_STATUS_RANK:
      //   needsReview > reassigned > revoked > approved
      //   - needsReview always wins so outstanding work is never hidden.
      //   - reassignment stays terminal over a plain keep/remove decision.
      //   - revoked > approved is an arbitrary-but-fixed order for the defensive
      //     decided-vs-decided collision (one access item comes from one review
      //     item, so this should not occur in practice).
      // Keep the incoming status only when it strictly outranks the existing one.
      if (
        tuple.reviewStatus &&
        (existing.reviewStatus === undefined ||
          REVIEW_STATUS_RANK[tuple.reviewStatus] >
            REVIEW_STATUS_RANK[existing.reviewStatus])
      ) {
        existing.reviewStatus = tuple.reviewStatus
      }
    }
  }
  return [...byKey.values()]
}
