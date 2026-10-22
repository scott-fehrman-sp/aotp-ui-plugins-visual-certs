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
import type {
  EntitlementsApi,
  EntitlementV2,
} from 'sailpoint-api-client/entitlements/api'
import type { IdentitiesApi } from 'sailpoint-api-client/identities/api'
import type { RolesApi } from 'sailpoint-api-client/roles/api'
import type { SourcesApi } from 'sailpoint-api-client/sources/api'
import { fetchIdentityDetail, type ResolvedIdentity } from './identities'
import type {
  AccessGraphNodeKind,
  AccessMatrixRowVM,
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
  // --- extra attributes surfaced in the node detail panel --------------------
  // Each is soft-degraded to '' (strings) / false (flags) when the SDK omits
  // it, so a sparse entitlement never shows a wall of "not set" lines (the
  // panel's visibility filter drops blank/false rows).
  /** The source-schema attribute name backing this entitlement (e.g. `memberOf`). */
  attribute: string
  /** The entitlement's raw value on the source. */
  value: string
  /** The source-schema object type (e.g. `group`). */
  objectType: string
  /** True if the entitlement is marked privileged by its privilege level. */
  privileged: boolean
  /** True if the entitlement is cloud governed. */
  cloudGoverned: boolean
  /** True if the entitlement can be directly requested. */
  requestable: boolean
  /** Owner display name ('' when no owner). */
  owner: string
  /** Comma-joined tag list ('' when none). */
  tags: string
  /** ISO timestamp the entitlement was created ('' when absent). */
  created: string
  /** ISO timestamp the entitlement was last modified ('' when absent). */
  modified: string
  /**
   * The free-form source attributes (the SDK's `attributes` map), as ordered
   * `[key, value]` pairs with each value stringified for display (arrays joined
   * with ', ', objects JSON-encoded). Mirrors the "Additional Attributes"
   * section of the ISC entitlement detail panel. Empty when the source carried
   * none.
   */
  attributes: Array<[string, string]>
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
  /** Entitlement body (name + source + attributes). null = soft-degraded. */
  entitlement(id: string): Promise<ResolvedEntitlement | null>
  /**
   * Resolves an entitlement by NAME, for refs that carry no id (a role or
   * access profile that referenced an entitlement by name only). Backed by the
   * list endpoint + a per-name cache. Every entitlement is source-backed, so
   * this recovers the source + attributes a bare name-only ref would lose.
   * null = soft-degraded (no match or any failure).
   */
  entitlementByName(name: string): Promise<ResolvedEntitlement | null>
  /**
   * A source's name + description, for the source-node tooltip. Backed by a
   * per-source-id cache so a source shared by many entitlements is fetched at
   * most once. null = soft-degraded.
   */
  source(id: string): Promise<{ id: string; name: string; description: string } | null>
  /**
   * A user's full identity detail (department, location, email, title, phone,
   * manager, lifecycle / identity state, isManager, identity id) for the user
   * node's detail panel. Backed by a per-identity cache (fetch-once,
   * concurrent-dedupe). Soft-degrades every field to '' and never throws.
   */
  identity(id: string): Promise<ResolvedIdentity>
}

/**
 * Stringifies one free-form source-attribute value for display: an array joins
 * with ', ' (mirrors `proxyAddresses` in the ISC panel), a boolean/number uses
 * its literal, a nested object JSON-encodes, and null/undefined becomes ''. Any
 * stringify failure degrades to '' rather than throwing.
 */
function stringifyAttributeValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    return value.map((v) => stringifyAttributeValue(v)).join(', ')
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

/**
 * Flattens the SDK's free-form `attributes` map into ordered `[key, value]`
 * string pairs for the detail panel's "Additional attributes" section. Keys are
 * sorted for a stable, deterministic order (the SDK map order is unspecified).
 * A missing map yields an empty list.
 */
function flattenSourceAttributes(
  attributes: Record<string, unknown> | null | undefined,
): Array<[string, string]> {
  if (!attributes) return []
  return Object.keys(attributes)
    .sort((a, b) => a.localeCompare(b))
    .map((key): [string, string] => [key, stringifyAttributeValue(attributes[key])])
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
  identitiesApi: IdentitiesApi,
): AccessCompositionResolver {
  const roleCache = new Map<string, Promise<ResolvedRole | null>>()
  const apCache = new Map<string, Promise<ResolvedAccessProfile | null>>()
  const entCache = new Map<string, Promise<ResolvedEntitlement | null>>()
  // Per-NAME cache for the id-less fallback lookup (keyed by entitlement name).
  const entByNameCache = new Map<string, Promise<ResolvedEntitlement | null>>()
  // Per-source-id cache: a source shared by many entitlements is fetched once.
  const sourceCache = new Map<
    string,
    Promise<{ id: string; name: string; description: string } | null>
  >()
  // Per-identity cache for the user detail lookup.
  const identityCache = new Map<string, Promise<ResolvedIdentity>>()

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
      return await mapEntitlement(res.data, id)
    } catch {
      return null
    }
  }

  // Maps a raw SDK entitlement body to a ResolvedEntitlement, routing the
  // source description through the per-source-id cache so a source shared by
  // many entitlements is fetched at most once. Shared by the by-id and by-name
  // fetch paths. `fallbackId` is the id we already knew (the lookup id for
  // getEntitlementV1, or null for a name lookup) and backfills `id` when the
  // body omits it.
  const mapEntitlement = async (
    ent: EntitlementV2,
    fallbackId: string | null,
  ): Promise<ResolvedEntitlement> => {
    const sourceId = ent.source?.id ?? null
    const resolvedSource = sourceId ? await source(sourceId) : null
    // The SDK models `privileged` inside `privilegeLevel`; treat the presence
    // of a truthy privilege indicator as "privileged". Guard with optional
    // chaining so a missing block degrades to false rather than throwing.
    const privilege = ent.privilegeLevel as { privileged?: boolean } | undefined
    return {
      id: ent.id ?? fallbackId ?? '',
      name: ent.name ?? '',
      description: ent.description ?? '',
      sourceId,
      sourceName: ent.source?.name ?? '',
      sourceDescription: resolvedSource?.description ?? '',
      attribute: ent.attribute ?? '',
      value: ent.value ?? '',
      objectType: ent.sourceSchemaObjectType ?? '',
      privileged: privilege?.privileged ?? false,
      cloudGoverned: ent.cloudGoverned ?? false,
      requestable: ent.requestable ?? false,
      owner: ent.owner?.name ?? '',
      tags: (ent.tags ?? []).join(', '),
      created: ent.created ?? '',
      modified: ent.modified ?? '',
      attributes: flattenSourceAttributes(ent.attributes),
    }
  }

  // Resolves an entitlement by NAME when no id is known (a role/AP referenced
  // it by name only). Uses the list endpoint with a `name eq` filter; takes the
  // first match. Every entitlement is source-backed, so this recovers the
  // source + attributes a bare name-only ref would otherwise lose. Soft-degrades
  // (no match / any failure) to null exactly like the by-id path. The empty
  // name short-circuits to null (nothing to look up).
  const fetchEntitlementByName = async (
    name: string,
  ): Promise<ResolvedEntitlement | null> => {
    if (!name) return null
    try {
      // Escape embedded double-quotes so a name with a quote can't break the
      // filter expression.
      const escaped = name.replace(/"/g, '\\"')
      const res = await entitlementsApi.listEntitlementsV1({
        filters: `name eq "${escaped}"`,
        limit: 1,
      })
      const match = res.data?.[0]
      if (!match) return null
      return await mapEntitlement(match, match.id ?? null)
    } catch {
      return null
    }
  }

  // Identity has its own fetch-once cache (not the generic `cached` helper)
  // because it resolves to a non-null `ResolvedIdentity` — `fetchIdentityDetail`
  // soft-degrades every failure (and the empty id) to an all-'' object rather
  // than null, so the user node always has a usable detail to render.
  const identity = (id: string): Promise<ResolvedIdentity> => {
    const hit = identityCache.get(id)
    if (hit) return hit
    const promise = fetchIdentityDetail(identitiesApi, id)
    identityCache.set(id, promise)
    return promise
  }

  return {
    role: (id) => cached(roleCache, id, fetchRole),
    accessProfile: (id) => cached(apCache, id, fetchAccessProfile),
    entitlement: (id) => cached(entCache, id, fetchEntitlement),
    entitlementByName: (name) =>
      cached(entByNameCache, name, fetchEntitlementByName),
    source,
    identity,
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
  /** Resolved entitlement source-schema attribute name, on a resolved leaf row. */
  entitlementAttribute?: string
  /** Resolved entitlement value, on a resolved leaf row. */
  entitlementValue?: string
  /** Resolved entitlement source-schema object type, on a resolved leaf row. */
  entitlementObjectType?: string
  /** Resolved entitlement privileged flag, on a resolved leaf row. */
  entitlementPrivileged?: boolean
  /** Resolved entitlement cloud-governed flag, on a resolved leaf row. */
  entitlementCloudGoverned?: boolean
  /** Resolved entitlement requestable flag, on a resolved leaf row. */
  entitlementRequestable?: boolean
  /** Resolved entitlement owner display name, on a resolved leaf row. */
  entitlementOwner?: string
  /** Resolved entitlement tags (comma-joined), on a resolved leaf row. */
  entitlementTags?: string
  /** Resolved entitlement created timestamp, on a resolved leaf row. */
  entitlementCreated?: string
  /** Resolved entitlement modified timestamp, on a resolved leaf row. */
  entitlementModified?: string
  /** Resolved free-form source attributes ([key, value] pairs), on a leaf row. */
  entitlementAttributes?: Array<[string, string]>
  /** Resolved SOURCE description, on a resolved leaf row. */
  sourceDescription?: string
  /** Kind of the user's directly-held access item (first hop off the user). */
  accessItemKind?: AccessGraphNodeKind
  /** Id of the user's directly-held access item; null when the item had none. */
  accessItemId?: string | null
  /** The review item's own display name (review-key fallback / blank-label fallback). */
  accessItemName?: string
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
  entitlementAttribute?: string
  entitlementValue?: string
  entitlementObjectType?: string
  entitlementPrivileged?: boolean
  entitlementCloudGoverned?: boolean
  entitlementRequestable?: boolean
  entitlementOwner?: string
  entitlementTags?: string
  entitlementCreated?: string
  entitlementModified?: string
  entitlementAttributes?: Array<[string, string]>
}> {
  // Prefer the id (exact, one round-trip). When the parent body referenced the
  // entitlement by NAME only (no id), fall back to a by-name lookup rather than
  // giving up: every entitlement is source-backed, so the name lookup still
  // recovers the source + attributes. Only when BOTH fail do we emit a bare,
  // unresolved row.
  const resolved = ref.id
    ? await resolver.entitlement(ref.id)
    : await resolver.entitlementByName(ref.name)
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
    // A by-name lookup may land an entitlement with no id in its body; coerce
    // the empty string back to null so rowKey falls back to the name key rather
    // than treating "" as a distinct id.
    entitlementId: resolved.id || null,
    source: resolved.sourceName,
    sourceId: resolved.sourceId,
    unresolved: false,
    entitlementDescription: resolved.description,
    sourceDescription: resolved.sourceDescription,
    entitlementAttribute: resolved.attribute,
    entitlementValue: resolved.value,
    entitlementObjectType: resolved.objectType,
    entitlementPrivileged: resolved.privileged,
    entitlementCloudGoverned: resolved.cloudGoverned,
    entitlementRequestable: resolved.requestable,
    entitlementOwner: resolved.owner,
    entitlementTags: resolved.tags,
    entitlementCreated: resolved.created,
    entitlementModified: resolved.modified,
    entitlementAttributes: resolved.attributes,
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
  const identity = await resolver.identity(item.identityId)
  // The directly-held access-item identity (kind, id, name) attaches to the
  // review item itself (independent of how its composition expands), so fold it
  // into `base` and let it land on EVERY row — exactly like department/location.
  // Review STATUS is deliberately not stamped here: it is a live overlay applied
  // after resolution (`domain/reviewOverlay.ts`) so a decision never re-resolves.
  // The generic `access` fallback has no composition node, so it carries no
  // access-item kind and nothing downstream is treated as a review hop.
  const accessItemKind: AccessGraphNodeKind | undefined =
    item.accessKind === 'role' ||
    item.accessKind === 'accessProfile' ||
    item.accessKind === 'entitlement'
      ? item.accessKind
      : undefined
  const base = {
    userId: item.identityId,
    user: item.personName,
    userDepartment: identity.department,
    userLocation: identity.location,
    userCountry: identity.country,
    userEmail: identity.email,
    userTitle: identity.title,
    userPhone: identity.phone,
    userIsManager: identity.isManager,
    userManager: identity.manager,
    userLifecycleState: identity.lifecycleState,
    userIdentityState: identity.identityState,
    userIdentityId: identity.identityId || item.identityId,
    accessItemKind,
    accessItemId: item.accessId ?? null,
    accessItemName: item.accessName,
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
    if (ap.entitlementRefs.length === 0) {
      // Resolved but empty: the item is still a reviewable first-level hop, so
      // emit one bare row (name/id of the AP, blank leaf) instead of vanishing.
      return [
        {
          ...base,
          role: '',
          roleId: null,
          accessProfile: ap.name,
          accessProfileId: ap.id,
          accessProfileDescription: ap.description,
          entitlement: '',
          entitlementId: null,
          source: '',
          sourceId: null,
          unresolved: false,
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

  if (role.accessProfileRefs.length === 0 && role.entitlementRefs.length === 0) {
    // Resolved but empty role: still a reviewable first-level hop (see the AP
    // case above), so emit one bare row rather than nothing.
    return [
      {
        ...base,
        role: role.name,
        roleId: role.id,
        roleDescription: role.description,
        accessProfile: '',
        accessProfileId: null,
        entitlement: '',
        entitlementId: null,
        source: '',
        sourceId: null,
        unresolved: false,
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
      // First-wins on collision: every enrichment field keeps the first row's
      // value. Review status is not on the row (live overlay), so there is
      // nothing to merge.
      if (!byKey.has(id)) byKey.set(id, { id, ...tuple })
    }
  }
  return [...byKey.values()]
}
