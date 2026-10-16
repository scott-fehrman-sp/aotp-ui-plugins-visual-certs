import { describe, expect, it, vi } from 'vitest'
import { resolveMatrix } from './accessMatrix'
import type {
  AccessCompositionResolver,
  ResolvedAccessProfile,
  ResolvedEntitlement,
  ResolvedRole,
} from './accessMatrix'
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
      accessProfileRefs: [{ id: 'ap-foo', name: 'foo' }],
      entitlementRefs: [{ id: 'ent-delete-engr', name: 'delete' }],
    },
  }
  const aps: Record<string, ResolvedAccessProfile> = {
    'ap-foo': {
      id: 'ap-foo',
      name: 'foo',
      entitlementRefs: [
        { id: 'ent-read-engr', name: 'read' },
        { id: 'ent-write-engr', name: 'write' },
      ],
    },
    'ap-bar': {
      id: 'ap-bar',
      name: 'bar',
      entitlementRefs: [
        { id: 'ent-read-acct', name: 'read' },
        { id: 'ent-search-acct', name: 'search' },
      ],
    },
  }
  const ents: Record<string, ResolvedEntitlement> = {
    'ent-read-engr': { id: 'ent-read-engr', name: 'read', sourceId: 'src-engr', sourceName: 'engr db' },
    'ent-write-engr': { id: 'ent-write-engr', name: 'write', sourceId: 'src-engr', sourceName: 'engr db' },
    'ent-delete-engr': { id: 'ent-delete-engr', name: 'delete', sourceId: 'src-engr', sourceName: 'engr db' },
    'ent-read-acct': { id: 'ent-read-acct', name: 'read', sourceId: 'src-acct', sourceName: 'accounting db' },
    'ent-search-acct': { id: 'ent-search-acct', name: 'search', sourceId: 'src-acct', sourceName: 'accounting db' },
    'ent-read-phone': { id: 'ent-read-phone', name: 'read', sourceId: 'src-phone', sourceName: 'phone app' },
  }
  return {
    role: (id) => Promise.resolve(roles[id] ?? null),
    accessProfile: (id) => Promise.resolve(aps[id] ?? null),
    entitlement: (id) => Promise.resolve(ents[id] ?? null),
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
})
