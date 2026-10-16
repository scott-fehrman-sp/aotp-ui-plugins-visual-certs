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
import type { AccessMatrixRowVM, ReviewItemVM } from './types'

// --- internal, DTO-free resolved shapes (never exposed to components) --------

/** A role's composition: its access profiles + its directly-attached entitlements. */
export interface ResolvedRole {
  id: string
  name: string
  /** Access-profile refs on the role (shallow: id + name only). */
  accessProfileRefs: Array<{ id: string | null; name: string }>
  /** Entitlement refs attached directly to the role (shallow: id + name only). */
  entitlementRefs: Array<{ id: string | null; name: string }>
}

/** An access profile's composition: its entitlement refs (shallow). */
export interface ResolvedAccessProfile {
  id: string
  name: string
  entitlementRefs: Array<{ id: string | null; name: string }>
}

/** A leaf entitlement's name + the source it lives on. */
export interface ResolvedEntitlement {
  id: string
  name: string
  sourceId: string | null
  sourceName: string
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
): AccessCompositionResolver {
  const roleCache = new Map<string, Promise<ResolvedRole | null>>()
  const apCache = new Map<string, Promise<ResolvedAccessProfile | null>>()
  const entCache = new Map<string, Promise<ResolvedEntitlement | null>>()

  const fetchRole = async (id: string): Promise<ResolvedRole | null> => {
    try {
      const res = await rolesApi.getRoleV1({ id })
      const role = res.data
      return {
        id: role.id ?? id,
        name: role.name ?? '',
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
      return {
        id: ent.id ?? id,
        name: ent.name ?? '',
        sourceId: ent.source?.id ?? null,
        sourceName: ent.source?.name ?? '',
      }
    } catch {
      return null
    }
  }

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

  return {
    role: (id) => cached(roleCache, id, fetchRole),
    accessProfile: (id) => cached(apCache, id, fetchAccessProfile),
    entitlement: (id) => cached(entCache, id, fetchEntitlement),
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
  const base = {
    userId: item.identityId,
    user: item.personName,
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
        accessProfile: ap.name,
        accessProfileId: ap.id,
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
      accessProfile: '',
      accessProfileId: null,
      ...leaf,
    })
  }

  return rows
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
      if (!byKey.has(id)) {
        byKey.set(id, { id, ...tuple })
      }
    }
  }
  return [...byKey.values()]
}
