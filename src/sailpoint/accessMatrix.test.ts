import { describe, expect, it, vi } from 'vitest'
import type {
  AccessProfilesApi,
  EntitlementsApi,
  IdentitiesApi,
  RolesApi,
  SourcesApi,
} from 'sailpoint-api-client'
import { createAccessCompositionResolver, resolveMatrix } from './accessMatrix'
import type {
  AccessCompositionResolver,
  ResolvedAccessProfile,
  ResolvedEntitlement,
  ResolvedRole,
  ResolvedSource,
} from './accessMatrix'
import { emptyResolvedIdentity } from './identities'
import type { ReviewItemVM } from './types'

function item(overrides: Partial<ReviewItemVM>): ReviewItemVM {
  return {
    id: 'r1',
    identityId: 'u1',
    completed: false,
    decision: null,
    reassigned: false,
    comments: null,
    personName: 'User One',
    accessName: 'access',
    accessKind: 'access',
    accessId: null,
    accessDescription: null,
    sourceName: null,
    isNewAccess: false,
    isPrivileged: false,
    isCloudGoverned: false,
    dataImpact: null,
    usageDays: null,
    aiRecommendation: null,
    revocable: true,
    ...overrides,
  }
}

/**
 * A stub resolver backed by plain canned composition for the worked example.
 * No network. Composition (documents the user's example explicitly):
 *   Role A (role-a):
 *     - AP foo (ap-foo) = { read -> ent-read-engr, write -> ent-write-engr }
 *     - direct entitlement delete -> ent-delete-engr
 *   AP bar (ap-bar) = { read -> ent-read-acct, search -> ent-search-acct }
 *   direct entitlement read -> ent-read-phone
 * Every entitlement resolves to its own source.
 */
function stubResolver(): AccessCompositionResolver {
  // Fill the extra role/AP attribute fields with inert defaults so the literals
  // below stay focused on id/name/description/refs.
  const mkRole = (
    r: Pick<
      ResolvedRole,
      'id' | 'name' | 'description' | 'accessProfileRefs' | 'entitlementRefs'
    >,
  ): ResolvedRole => ({
    owner: '',
    enabled: false,
    requestable: false,
    privilegeLevel: '',
    dimensional: false,
    created: '',
    modified: '',
    ...r,
  })
  const mkAp = (
    a: Pick<ResolvedAccessProfile, 'id' | 'name' | 'description' | 'entitlementRefs'>,
  ): ResolvedAccessProfile => ({
    sourceName: '',
    owner: '',
    enabled: false,
    requestable: false,
    created: '',
    modified: '',
    ...a,
  })
  const roles: Record<string, ResolvedRole> = {
    'role-a': mkRole({
      id: 'role-a',
      name: 'Role A',
      description: 'Role A description',
      accessProfileRefs: [{ id: 'ap-foo', name: 'foo' }],
      entitlementRefs: [{ id: 'ent-delete-engr', name: 'delete' }],
    }),
    'role-empty': mkRole({
      id: 'role-empty',
      name: 'Empty Role',
      description: 'Role with nothing in it',
      accessProfileRefs: [],
      entitlementRefs: [],
    }),
  }
  const aps: Record<string, ResolvedAccessProfile> = {
    'ap-foo': mkAp({
      id: 'ap-foo',
      name: 'foo',
      description: 'AP foo description',
      entitlementRefs: [
        { id: 'ent-read-engr', name: 'read' },
        { id: 'ent-write-engr', name: 'write' },
      ],
    }),
    'ap-bar': mkAp({
      id: 'ap-bar',
      name: 'bar',
      description: 'AP bar description',
      entitlementRefs: [
        { id: 'ent-read-acct', name: 'read' },
        { id: 'ent-search-acct', name: 'search' },
      ],
    }),
    'ap-empty': mkAp({
      id: 'ap-empty',
      name: 'empty ap',
      description: 'AP with no entitlements',
      entitlementRefs: [],
    }),
  }
  // Fills the extra attribute fields with inert defaults so each literal below
  // stays focused on the id/name/description/source it actually exercises.
  const mkEnt = (
    e: Pick<
      ResolvedEntitlement,
      'id' | 'name' | 'description' | 'sourceId' | 'sourceName' | 'sourceDescription'
    >,
  ): ResolvedEntitlement => ({
    attribute: '',
    value: '',
    objectType: '',
    privileged: false,
    cloudGoverned: false,
    requestable: false,
    owner: '',
    tags: '',
    created: '',
    modified: '',
    attributes: [],
    source: null,
    ...e,
  })
  const mkSrc = (
    s: Pick<ResolvedSource, 'id' | 'name' | 'description'>,
  ): ResolvedSource => ({
    owner: '',
    type: '',
    connector: '',
    connectionType: '',
    category: '',
    cluster: '',
    authoritative: false,
    healthy: false,
    status: '',
    created: '',
    modified: '',
    ...s,
  })
  const ents: Record<string, ResolvedEntitlement> = {
    'ent-read-engr': mkEnt({ id: 'ent-read-engr', name: 'read', description: 'read engr', sourceId: 'src-engr', sourceName: 'engr db', sourceDescription: 'Engineering database' }),
    'ent-write-engr': mkEnt({ id: 'ent-write-engr', name: 'write', description: 'write engr', sourceId: 'src-engr', sourceName: 'engr db', sourceDescription: 'Engineering database' }),
    'ent-delete-engr': mkEnt({ id: 'ent-delete-engr', name: 'delete', description: 'delete engr', sourceId: 'src-engr', sourceName: 'engr db', sourceDescription: 'Engineering database' }),
    'ent-read-acct': mkEnt({ id: 'ent-read-acct', name: 'read', description: 'read acct', sourceId: 'src-acct', sourceName: 'accounting db', sourceDescription: 'Accounting database' }),
    'ent-search-acct': mkEnt({ id: 'ent-search-acct', name: 'search', description: 'search acct', sourceId: 'src-acct', sourceName: 'accounting db', sourceDescription: 'Accounting database' }),
    'ent-read-phone': mkEnt({ id: 'ent-read-phone', name: 'read', description: 'read phone', sourceId: 'src-phone', sourceName: 'phone app', sourceDescription: 'Phone application' }),
  }
  const sources: Record<string, ResolvedSource> = {
    'src-engr': mkSrc({ id: 'src-engr', name: 'engr db', description: 'Engineering database' }),
    'src-acct': mkSrc({ id: 'src-acct', name: 'accounting db', description: 'Accounting database' }),
    'src-phone': mkSrc({ id: 'src-phone', name: 'phone app', description: 'Phone application' }),
  }
  const entsByName: Record<string, ResolvedEntitlement> = {}
  for (const e of Object.values(ents)) entsByName[e.name] = e
  return {
    role: (id) => Promise.resolve(roles[id] ?? null),
    accessProfile: (id) => Promise.resolve(aps[id] ?? null),
    entitlement: (id) => Promise.resolve(ents[id] ?? null),
    entitlementByName: (name) => Promise.resolve(entsByName[name] ?? null),
    source: (id) => Promise.resolve(sources[id] ?? null),
    identity: () =>
      Promise.resolve(
        emptyResolvedIdentity({ department: 'Engineering', location: 'Austin' }),
      ),
  }
}

/** The three reviewed accesses that make up the worked example. */
function workedExampleItems(): ReviewItemVM[] {
  return [
    item({ id: 'rev-role', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' }),
    item({ id: 'rev-ap', accessKind: 'accessProfile', accessId: 'ap-bar', accessName: 'bar' }),
    item({ id: 'rev-ent', accessKind: 'entitlement', accessId: 'ent-read-phone', accessName: 'read' }),
  ]
}

/** Normalizes a row to the five display columns for shape assertions. */
function shape(r: {
  user: string
  role: string
  accessProfile: string
  entitlement: string
  source: string
}) {
  return {
    user: r.user,
    role: r.role,
    accessProfile: r.accessProfile,
    entitlement: r.entitlement,
    source: r.source,
  }
}

describe('resolveMatrix', () => {
  it('expands the worked example into exactly the 6 golden rows', async () => {
    const rows = await resolveMatrix(workedExampleItems(), stubResolver())
    expect(rows).toHaveLength(6)
    expect(rows.map(shape)).toEqual([
      { user: 'User One', role: 'Role A', accessProfile: 'foo', entitlement: 'read', source: 'engr db' },
      { user: 'User One', role: 'Role A', accessProfile: 'foo', entitlement: 'write', source: 'engr db' },
      { user: 'User One', role: 'Role A', accessProfile: '', entitlement: 'delete', source: 'engr db' },
      { user: 'User One', role: '', accessProfile: 'bar', entitlement: 'read', source: 'accounting db' },
      { user: 'User One', role: '', accessProfile: 'bar', entitlement: 'search', source: 'accounting db' },
      { user: 'User One', role: '', accessProfile: '', entitlement: 'read', source: 'phone app' },
    ])
    // No row is unresolved in the fully-resolvable example.
    expect(rows.every((r) => !r.unresolved)).toBe(true)
    // Both foo rows carry accessProfile='foo'; the delete row is blank.
    expect(rows.filter((r) => r.accessProfile === 'foo')).toHaveLength(2)
    expect(rows.find((r) => r.entitlement === 'delete')?.accessProfile).toBe('')
  })

  it('collapses an identical path produced twice into one row (five-id dedup)', async () => {
    const items = [
      item({ id: 'a', accessKind: 'entitlement', accessId: 'ent-read-phone', accessName: 'read' }),
      item({ id: 'b', accessKind: 'entitlement', accessId: 'ent-read-phone', accessName: 'read' }),
    ]
    const rows = await resolveMatrix(items, stubResolver())
    expect(rows).toHaveLength(1)
  })

  it('keeps distinct paths to the same leaf as separate rows', async () => {
    // The same leaf ent-read-phone, once direct and once via AP bar2 — the
    // (roleId, accessProfileId) prefix differs so they do NOT collapse.
    const resolver: AccessCompositionResolver = {
      ...stubResolver(),
      accessProfile: (id) =>
        id === 'ap-bar2'
          ? Promise.resolve({
              id: 'ap-bar2',
              name: 'bar2',
              description: 'AP bar2 description',
              entitlementRefs: [{ id: 'ent-read-phone', name: 'read' }],
              sourceName: '',
              owner: '',
              enabled: false,
              requestable: false,
              created: '',
              modified: '',
            })
          : stubResolver().accessProfile(id),
    }
    const items = [
      item({ id: 'direct', accessKind: 'entitlement', accessId: 'ent-read-phone', accessName: 'read' }),
      item({ id: 'viaAp', accessKind: 'accessProfile', accessId: 'ap-bar2', accessName: 'bar2' }),
    ]
    const rows = await resolveMatrix(items, resolver)
    expect(rows).toHaveLength(2)
  })

  it('resolves an id-less entitlement ref by name (recovering its source + attributes)', async () => {
    // An AP whose entitlement ref carries a NAME but no id (what triggers the
    // bare, source-less node in the field). resolveLeaf must fall back to the
    // by-name lookup so the row still gets the full source + attributes.
    const resolver: AccessCompositionResolver = {
      ...stubResolver(),
      accessProfile: (id) =>
        id === 'ap-noid'
          ? Promise.resolve({
              id: 'ap-noid',
              name: 'No-id AP',
              description: '',
              entitlementRefs: [{ id: null, name: 'read' }],
              sourceName: '',
              owner: '',
              enabled: false,
              requestable: false,
              created: '',
              modified: '',
            })
          : stubResolver().accessProfile(id),
    }
    const items = [
      item({ id: 'i', accessKind: 'accessProfile', accessId: 'ap-noid', accessName: 'No-id AP' }),
    ]
    const rows = await resolveMatrix(items, resolver)
    expect(rows).toHaveLength(1)
    const [r] = rows
    expect(r.unresolved).toBe(false)
    expect(r.entitlement).toBe('read')
    // The name lookup backfilled a real id + source + description (the stub's
    // entsByName maps the name 'read' to ent-read-phone on phone app).
    expect(r.entitlementId).toBe('ent-read-phone')
    expect(r.source).toBe('phone app')
    expect(r.sourceId).toBe('src-phone')
    expect(r.entitlementDescription).toBe('read phone')
  })

  it('still emits an unresolved row when both id and name lookups fail', async () => {
    // A name-only ref whose name matches nothing: both the (absent) id path and
    // the by-name path return null, so the row degrades honestly.
    const resolver: AccessCompositionResolver = {
      ...stubResolver(),
      accessProfile: () =>
        Promise.resolve({
          id: 'ap-x',
          name: 'AP X',
          description: '',
          entitlementRefs: [{ id: null, name: 'does-not-exist' }],
          sourceName: '',
          owner: '',
          enabled: false,
          requestable: false,
          created: '',
          modified: '',
        }),
      entitlementByName: () => Promise.resolve(null),
    }
    const items = [
      item({ id: 'i', accessKind: 'accessProfile', accessId: 'ap-x', accessName: 'AP X' }),
    ]
    const rows = await resolveMatrix(items, resolver)
    expect(rows).toHaveLength(1)
    expect(rows[0].unresolved).toBe(true)
    expect(rows[0].entitlement).toBe('does-not-exist')
    expect(rows[0].entitlementId).toBeNull()
    expect(rows[0].source).toBe('')
  })

  it('emits an unresolved row (no throw) when the resolver returns null for a leaf', async () => {
    const resolver: AccessCompositionResolver = {
      role: () => Promise.resolve(null),
      accessProfile: () => Promise.resolve(null),
      entitlement: () => Promise.resolve(null),
      entitlementByName: () => Promise.resolve(null),
      source: () => Promise.resolve(null),
      identity: () => Promise.resolve(emptyResolvedIdentity()),
    }
    const items = [
      item({ id: 'e', accessKind: 'entitlement', accessId: 'ent-x', accessName: 'read' }),
    ]
    const rows = await resolveMatrix(items, resolver)
    expect(rows).toHaveLength(1)
    expect(rows[0].unresolved).toBe(true)
    // The ref name/id is retained; the source could not be fetched.
    expect(rows[0].entitlement).toBe('read')
    expect(rows[0].entitlementId).toBe('ent-x')
    expect(rows[0].source).toBe('')
  })

  it('fetches each id at most once across items (concurrent dedupe)', async () => {
    // Two role items referencing the SAME role resolve the role once.
    const roleFn = vi.fn().mockResolvedValue({
      id: 'role-a',
      name: 'Role A',
      description: 'Role A description',
      accessProfileRefs: [],
      entitlementRefs: [{ id: 'ent-delete-engr', name: 'delete' }],
      owner: '',
      enabled: false,
      requestable: false,
      privilegeLevel: '',
      dimensional: false,
      created: '',
      modified: '',
    } satisfies ResolvedRole)
    // The hook's resolver caches; here we assert resolveMatrix calls the
    // resolver's `role` once per distinct id when the resolver itself dedupes.
    const base = stubResolver()
    const cache = new Map<string, Promise<ResolvedRole | null>>()
    const resolver: AccessCompositionResolver = {
      ...base,
      role: (id) => {
        const hit = cache.get(id)
        if (hit) return hit
        const p = roleFn(id)
        cache.set(id, p)
        return p
      },
    }
    const items = [
      item({ id: 'r1', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' }),
      item({ id: 'r2', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' }),
    ]
    await resolveMatrix(items, resolver)
    expect(roleFn).toHaveBeenCalledTimes(1)
  })

  it('produces exactly one all-blank-leaf row for an access-kind item', async () => {
    const rows = await resolveMatrix(
      [item({ id: 'generic', accessKind: 'access', accessId: null })],
      stubResolver(),
    )
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.unresolved).toBe(true)
    expect(r.user).toBe('User One')
    expect(r.userId).toBe('u1')
    expect(shape(r)).toEqual({
      user: 'User One',
      role: '',
      accessProfile: '',
      entitlement: '',
      source: '',
    })
    expect(r.roleId).toBeNull()
    expect(r.accessProfileId).toBeNull()
    expect(r.entitlementId).toBeNull()
    expect(r.sourceId).toBeNull()
  })

  it('collapses two access-kind rows for the same user into one', async () => {
    const rows = await resolveMatrix(
      [
        item({ id: 'g1', accessKind: 'access', accessId: null }),
        item({ id: 'g2', accessKind: 'access', accessId: null }),
      ],
      stubResolver(),
    )
    expect(rows).toHaveLength(1)
  })

  it('carries descriptive enrichment on the resolved worked-example rows', async () => {
    const rows = await resolveMatrix(workedExampleItems(), stubResolver())
    // Every row for the user carries its department/location.
    expect(rows.every((r) => r.userDepartment === 'Engineering')).toBe(true)
    expect(rows.every((r) => r.userLocation === 'Austin')).toBe(true)

    // Role rows carry the role + AP + entitlement + source descriptions.
    const fooRead = rows.find(
      (r) => r.accessProfile === 'foo' && r.entitlement === 'read',
    )
    expect(fooRead?.roleDescription).toBe('Role A description')
    expect(fooRead?.accessProfileDescription).toBe('AP foo description')
    expect(fooRead?.entitlementDescription).toBe('read engr')
    expect(fooRead?.sourceDescription).toBe('Engineering database')

    // The role-direct `delete` row has a role description but no AP description.
    const del = rows.find((r) => r.entitlement === 'delete')
    expect(del?.roleDescription).toBe('Role A description')
    expect(del?.accessProfileDescription).toBeUndefined()

    // The direct phone entitlement row carries its own source description.
    const phone = rows.find((r) => r.source === 'phone app')
    expect(phone?.sourceDescription).toBe('Phone application')
  })

  it('soft-degrades a failed SOURCE fetch to empty description without changing row identity', async () => {
    // A resolver whose source() always fails (null) but entitlement still
    // resolves and keeps the sourceName; sourceDescription degrades to ''.
    const resolver: AccessCompositionResolver = {
      ...stubResolver(),
      entitlement: (id) =>
        Promise.resolve(
          id === 'ent-read-phone'
            ? {
                id: 'ent-read-phone',
                name: 'read',
                description: 'read phone',
                sourceId: 'src-phone',
                sourceName: 'phone app',
                // Mirrors what fetchEntitlement produces when source() → null.
                sourceDescription: '',
                attribute: '',
                value: '',
                objectType: '',
                privileged: false,
                cloudGoverned: false,
                requestable: false,
                owner: '',
                tags: '',
                created: '',
                modified: '',
                attributes: [],
                source: null,
              }
            : null,
        ),
      source: () => Promise.resolve(null),
    }
    const withSource = await resolveMatrix(
      [item({ id: 'rev-ent', accessKind: 'entitlement', accessId: 'ent-read-phone', accessName: 'read' })],
      stubResolver(),
    )
    const degraded = await resolveMatrix(
      [item({ id: 'rev-ent', accessKind: 'entitlement', accessId: 'ent-read-phone', accessName: 'read' })],
      resolver,
    )
    // Same row count and same five-id identity; only the description differs.
    expect(degraded).toHaveLength(1)
    expect(degraded[0].id).toBe(withSource[0].id)
    expect(degraded[0].source).toBe('phone app')
    expect(degraded[0].sourceDescription).toBe('')
    expect(degraded[0].unresolved).toBe(false)
  })

  it('soft-degrades a failed IDENTITY fetch to empty department/location without dropping rows', async () => {
    const resolver: AccessCompositionResolver = {
      ...stubResolver(),
      identity: () => Promise.resolve(emptyResolvedIdentity()),
    }
    const rows = await resolveMatrix(workedExampleItems(), resolver)
    expect(rows).toHaveLength(6)
    expect(rows.every((r) => r.userDepartment === '')).toBe(true)
    expect(rows.every((r) => r.userLocation === '')).toBe(true)
  })

  it('stamps access-item identity (kind, id, name) onto every row and no review status', async () => {
    // Each item's directly-held identity lands on every row it produced. Review
    // STATUS is a live overlay (domain/reviewOverlay), never on a resolved row,
    // so decisions made after resolution cannot go stale here.
    const items = [
      item({ id: 'rev-role', accessKind: 'role', accessId: 'role-a', accessName: 'Role A', completed: true, decision: 'APPROVE' }),
      item({ id: 'rev-ap', accessKind: 'accessProfile', accessId: 'ap-bar', accessName: 'bar' }),
      item({ id: 'rev-ent', accessKind: 'entitlement', accessId: 'ent-read-phone', accessName: 'read', reassigned: true }),
    ]
    const rows = await resolveMatrix(items, stubResolver())

    const roleRows = rows.filter((r) => r.role === 'Role A')
    expect(roleRows.length).toBeGreaterThan(0)
    expect(roleRows.every((r) => r.accessItemKind === 'role')).toBe(true)
    expect(roleRows.every((r) => r.accessItemId === 'role-a')).toBe(true)
    expect(roleRows.every((r) => r.accessItemName === 'Role A')).toBe(true)

    const apRows = rows.filter((r) => r.accessProfile === 'bar')
    expect(apRows.length).toBeGreaterThan(0)
    expect(apRows.every((r) => r.accessItemKind === 'accessProfile')).toBe(true)
    expect(apRows.every((r) => r.accessItemId === 'ap-bar')).toBe(true)
    expect(apRows.every((r) => r.accessItemName === 'bar')).toBe(true)

    const phoneRow = rows.find((r) => r.source === 'phone app')
    expect(phoneRow?.accessItemKind).toBe('entitlement')
    expect(phoneRow?.accessItemId).toBe('ent-read-phone')
    expect(phoneRow?.accessItemName).toBe('read')

    expect(rows.every((r) => !('reviewStatus' in r))).toBe(true)
  })

  it('collapses a same-path collision to one first-wins row regardless of status', async () => {
    // The same leaf path produced by a kept and a reassigned item collapses to a
    // single row; status is not on the row, so the survivor is simply the first.
    const items = [
      item({ id: 'kept', accessKind: 'entitlement', accessId: 'ent-read-phone', accessName: 'read', completed: true, decision: 'APPROVE' }),
      item({ id: 'moved', accessKind: 'entitlement', accessId: 'ent-read-phone', accessName: 'read', reassigned: true }),
    ]
    const rows = await resolveMatrix(items, stubResolver())
    expect(rows).toHaveLength(1)
    expect(rows[0].accessItemId).toBe('ent-read-phone')
    expect('reviewStatus' in rows[0]).toBe(false)
  })

  it('keeps row count and ids invariant when decisions change', async () => {
    // Same worked example as the 6-golden-row test, but the items now carry
    // decisions; the dedup identity (rowKey) must not depend on them.
    const decided = workedExampleItems().map((it) =>
      item({ ...it, completed: true, decision: 'APPROVE' }),
    )
    const undecided = await resolveMatrix(workedExampleItems(), stubResolver())
    const withStatus = await resolveMatrix(decided, stubResolver())
    expect(withStatus).toHaveLength(6)
    expect(withStatus.map((r) => r.id).sort()).toEqual(
      undecided.map((r) => r.id).sort(),
    )
  })

  it('fetches a source at most once per source id across many entitlements', async () => {
    // src-engr is shared by read/write/delete. A per-source-id cache in front of
    // a source spy must call it once for src-engr though three entitlements use it.
    const base = stubResolver()
    const sourceFn = vi.fn(
      (id: string): Promise<ResolvedSource> =>
        Promise.resolve({
          id,
          name: 'engr db',
          description: 'Engineering database',
          owner: '',
          type: '',
          connector: '',
          connectionType: '',
          category: '',
          cluster: '',
          authoritative: false,
          healthy: false,
          status: '',
          created: '',
          modified: '',
        }),
    )
    const cache = new Map<string, Promise<ResolvedSource | null>>()
    const resolver: AccessCompositionResolver = {
      ...base,
      source: (id) => {
        const hit = cache.get(id)
        if (hit) return hit
        const p = sourceFn(id)
        cache.set(id, p)
        return p
      },
      // Entitlement resolution routes through the cached source(), mirroring
      // fetchEntitlement, so the spy sees one call per distinct source id.
      entitlement: async (id) => {
        const ent = await base.entitlement(id)
        if (!ent) return null
        const src = ent.sourceId ? await resolver.source(ent.sourceId) : null
        return { ...ent, sourceDescription: src?.description ?? '' }
      },
    }
    // Role A expands into read + write (via foo) + delete, all on src-engr.
    await resolveMatrix(
      [item({ id: 'rev-role', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' })],
      resolver,
    )
    expect(sourceFn).toHaveBeenCalledTimes(1)
    expect(sourceFn).toHaveBeenCalledWith('src-engr')
  })

  it('emits a first-level row for an access profile with zero entitlements', async () => {
    const rows = await resolveMatrix(
      [item({ id: 'rev-empty-ap', accessKind: 'accessProfile', accessId: 'ap-empty', accessName: 'empty ap' })],
      stubResolver(),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      accessProfile: 'empty ap',
      accessProfileId: 'ap-empty',
      entitlement: '',
      entitlementId: null,
      source: '',
      sourceId: null,
      unresolved: false,
      accessItemKind: 'accessProfile',
      accessItemId: 'ap-empty',
    })
  })

  it('emits a first-level row for a role with no access profiles or entitlements', async () => {
    const rows = await resolveMatrix(
      [item({ id: 'rev-empty-role', accessKind: 'role', accessId: 'role-empty', accessName: 'Empty Role' })],
      stubResolver(),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      role: 'Empty Role',
      roleId: 'role-empty',
      accessProfile: '',
      entitlement: '',
      source: '',
      unresolved: false,
      accessItemKind: 'role',
      accessItemId: 'role-empty',
    })
  })
})

describe('createAccessCompositionResolver entitlementByName', () => {
  // Minimal APIs: only the methods the by-name path touches. `listEntitlementsV1`
  // returns the same full EntitlementV2 body getEntitlementV1 does.
  function makeResolver() {
    const listEntitlementsV1 = vi.fn().mockImplementation(({ filters }) => {
      // Honor the `name eq "<name>"` filter the resolver builds.
      const match = /name eq "(.*)"/.exec(filters ?? '')
      const name = match?.[1] ?? ''
      const bodies: Record<string, unknown> = {
        read: {
          id: 'ent-read-engr',
          name: 'read',
          description: 'read engr',
          attribute: 'memberOf',
          value: 'cn=readers',
          sourceSchemaObjectType: 'group',
          cloudGoverned: true,
          requestable: true,
          tags: ['PII', 'SOX'],
          owner: { id: 'o1', type: 'IDENTITY', name: 'Dana Owner' },
          privilegeLevel: { privileged: true },
          created: '2024-01-02T00:00:00Z',
          modified: '2024-03-04T00:00:00Z',
          source: { id: 'src-engr', type: 'SOURCE', name: 'engr db' },
          attributes: {
            // Intentionally out of alphabetical order to prove sorting, and a
            // mix of value shapes (array, string, boolean) to prove flattening.
            proxyAddresses: ['SMTP:eng@x.com', 'SPO:eng'],
            displayName: 'Engineering',
            teamsEnabled: false,
          },
        },
      }
      const body = bodies[name]
      return Promise.resolve({ data: body ? [body] : [] })
    })
    const getSourceV1 = vi.fn().mockResolvedValue({
      data: {
        id: 'src-engr',
        name: 'engr db',
        description: 'Engineering database',
        owner: { id: 'o2', type: 'IDENTITY', name: 'Sam Source' },
        type: 'Active Directory',
        connectorName: 'active-directory',
        connectionType: 'direct',
        category: 'Directory',
        cluster: { id: 'c1', type: 'CLUSTER', name: 'VA Cluster' },
        authoritative: true,
        healthy: true,
        status: 'SOURCE_STATE_HEALTHY',
        created: '2023-01-01T00:00:00Z',
        modified: '2023-06-01T00:00:00Z',
      },
    })
    const resolver = createAccessCompositionResolver(
      {} as unknown as RolesApi,
      {} as unknown as AccessProfilesApi,
      { listEntitlementsV1 } as unknown as EntitlementsApi,
      { getSourceV1 } as unknown as SourcesApi,
      {} as unknown as IdentitiesApi,
    )
    return { resolver, listEntitlementsV1, getSourceV1 }
  }

  it('resolves an entitlement by name, recovering its source + full attributes', async () => {
    const { resolver, listEntitlementsV1 } = makeResolver()
    const ent = await resolver.entitlementByName('read')
    expect(listEntitlementsV1).toHaveBeenCalledWith({
      filters: 'name eq "read"',
      limit: 1,
    })
    expect(ent).toEqual({
      id: 'ent-read-engr',
      name: 'read',
      description: 'read engr',
      sourceId: 'src-engr',
      sourceName: 'engr db',
      sourceDescription: 'Engineering database',
      attribute: 'memberOf',
      value: 'cn=readers',
      objectType: 'group',
      privileged: true,
      cloudGoverned: true,
      requestable: true,
      owner: 'Dana Owner',
      tags: 'PII, SOX',
      created: '2024-01-02T00:00:00Z',
      modified: '2024-03-04T00:00:00Z',
      // Sorted by key; array joined with ', ', boolean stringified.
      attributes: [
        ['displayName', 'Engineering'],
        ['proxyAddresses', 'SMTP:eng@x.com, SPO:eng'],
        ['teamsEnabled', 'false'],
      ],
      // The resolved source rides along for the source node's detail panel.
      source: {
        id: 'src-engr',
        name: 'engr db',
        description: 'Engineering database',
        owner: 'Sam Source',
        type: 'Active Directory',
        connector: 'active-directory',
        connectionType: 'direct',
        category: 'Directory',
        cluster: 'VA Cluster',
        authoritative: true,
        healthy: true,
        status: 'SOURCE_STATE_HEALTHY',
        created: '2023-01-01T00:00:00Z',
        modified: '2023-06-01T00:00:00Z',
      },
    })
  })

  it('resolves a source to its full attribute set', async () => {
    const { resolver } = makeResolver()
    const src = await resolver.source('src-engr')
    expect(src).toEqual({
      id: 'src-engr',
      name: 'engr db',
      description: 'Engineering database',
      owner: 'Sam Source',
      type: 'Active Directory',
      connector: 'active-directory',
      connectionType: 'direct',
      category: 'Directory',
      cluster: 'VA Cluster',
      authoritative: true,
      healthy: true,
      status: 'SOURCE_STATE_HEALTHY',
      created: '2023-01-01T00:00:00Z',
      modified: '2023-06-01T00:00:00Z',
    })
  })

  it('caches by source id: a repeated source lookup hits the API once', async () => {
    const { resolver, getSourceV1 } = makeResolver()
    await resolver.source('src-engr')
    await resolver.source('src-engr')
    expect(getSourceV1).toHaveBeenCalledTimes(1)
  })

  it('soft-degrades to null when no entitlement matches the name', async () => {
    const { resolver } = makeResolver()
    expect(await resolver.entitlementByName('nope')).toBeNull()
  })

  it('short-circuits an empty name without hitting the API', async () => {
    const { resolver, listEntitlementsV1 } = makeResolver()
    expect(await resolver.entitlementByName('')).toBeNull()
    expect(listEntitlementsV1).not.toHaveBeenCalled()
  })

  it('caches by name: a repeated lookup hits the API once', async () => {
    const { resolver, listEntitlementsV1 } = makeResolver()
    await resolver.entitlementByName('read')
    await resolver.entitlementByName('read')
    expect(listEntitlementsV1).toHaveBeenCalledTimes(1)
  })
})
