import { describe, expect, it, vi } from 'vitest'
import { resolveMatrix } from './accessMatrix'
import type {
  AccessCompositionResolver,
  ResolvedAccessProfile,
  ResolvedEntitlement,
  ResolvedRole,
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
  const roles: Record<string, ResolvedRole> = {
    'role-a': {
      id: 'role-a',
      name: 'Role A',
      description: 'Role A description',
      accessProfileRefs: [{ id: 'ap-foo', name: 'foo' }],
      entitlementRefs: [{ id: 'ent-delete-engr', name: 'delete' }],
    },
    'role-empty': {
      id: 'role-empty',
      name: 'Empty Role',
      description: 'Role with nothing in it',
      accessProfileRefs: [],
      entitlementRefs: [],
    },
  }
  const aps: Record<string, ResolvedAccessProfile> = {
    'ap-foo': {
      id: 'ap-foo',
      name: 'foo',
      description: 'AP foo description',
      entitlementRefs: [
        { id: 'ent-read-engr', name: 'read' },
        { id: 'ent-write-engr', name: 'write' },
      ],
    },
    'ap-bar': {
      id: 'ap-bar',
      name: 'bar',
      description: 'AP bar description',
      entitlementRefs: [
        { id: 'ent-read-acct', name: 'read' },
        { id: 'ent-search-acct', name: 'search' },
      ],
    },
    'ap-empty': {
      id: 'ap-empty',
      name: 'empty ap',
      description: 'AP with no entitlements',
      entitlementRefs: [],
    },
  }
  const ents: Record<string, ResolvedEntitlement> = {
    'ent-read-engr': { id: 'ent-read-engr', name: 'read', description: 'read engr', sourceId: 'src-engr', sourceName: 'engr db', sourceDescription: 'Engineering database' },
    'ent-write-engr': { id: 'ent-write-engr', name: 'write', description: 'write engr', sourceId: 'src-engr', sourceName: 'engr db', sourceDescription: 'Engineering database' },
    'ent-delete-engr': { id: 'ent-delete-engr', name: 'delete', description: 'delete engr', sourceId: 'src-engr', sourceName: 'engr db', sourceDescription: 'Engineering database' },
    'ent-read-acct': { id: 'ent-read-acct', name: 'read', description: 'read acct', sourceId: 'src-acct', sourceName: 'accounting db', sourceDescription: 'Accounting database' },
    'ent-search-acct': { id: 'ent-search-acct', name: 'search', description: 'search acct', sourceId: 'src-acct', sourceName: 'accounting db', sourceDescription: 'Accounting database' },
    'ent-read-phone': { id: 'ent-read-phone', name: 'read', description: 'read phone', sourceId: 'src-phone', sourceName: 'phone app', sourceDescription: 'Phone application' },
  }
  const sources: Record<string, { id: string; name: string; description: string }> = {
    'src-engr': { id: 'src-engr', name: 'engr db', description: 'Engineering database' },
    'src-acct': { id: 'src-acct', name: 'accounting db', description: 'Accounting database' },
    'src-phone': { id: 'src-phone', name: 'phone app', description: 'Phone application' },
  }
  return {
    role: (id) => Promise.resolve(roles[id] ?? null),
    accessProfile: (id) => Promise.resolve(aps[id] ?? null),
    entitlement: (id) => Promise.resolve(ents[id] ?? null),
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

  it('emits an unresolved row (no throw) when the resolver returns null for a leaf', async () => {
    const resolver: AccessCompositionResolver = {
      role: () => Promise.resolve(null),
      accessProfile: () => Promise.resolve(null),
      entitlement: () => Promise.resolve(null),
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
    const sourceFn = vi.fn((id: string) =>
      Promise.resolve({ id, name: 'engr db', description: 'Engineering database' }),
    )
    const cache = new Map<
      string,
      Promise<{ id: string; name: string; description: string } | null>
    >()
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
