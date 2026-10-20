import { describe, expect, it } from 'vitest'
import { deriveAccessGraph } from './accessGraph'
import { computeAccessCounts } from './accessCounts'
import type { AccessMatrixRowVM } from '../sailpoint/types'

function row(overrides: Partial<AccessMatrixRowVM>): AccessMatrixRowVM {
  return {
    id: 'r',
    userId: 'u1',
    user: 'User One',
    role: '',
    roleId: null,
    accessProfile: '',
    accessProfileId: null,
    entitlement: '',
    entitlementId: null,
    source: '',
    sourceId: null,
    unresolved: false,
    ...overrides,
  }
}

describe('computeAccessCounts', () => {
  it('returns all zeros for an empty graph', () => {
    expect(computeAccessCounts({ nodes: [], edges: [] })).toEqual({
      users: 0,
      accessItems: 0,
      sources: 0,
    })
  })

  it('counts distinct users, leaf entitlements, and sources from the expanded graph', () => {
    // Two users. User One holds Role A (AP "foo" → read/write on engr db) plus a
    // direct entitlement on phone app. User Two holds AP "bar" → read on engr db
    // (same source + same entitlement name/id as one of User One's leaves, to
    // prove dedup by id). Distinct users=2, entitlements={e1,e2,e3,e4}=4,
    // sources={engr db, phone app}=2.
    const rows: AccessMatrixRowVM[] = [
      row({ id: '1', userId: 'u1', user: 'User One', role: 'Role A', roleId: 'ra', accessProfile: 'foo', accessProfileId: 'af', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
      row({ id: '2', userId: 'u1', user: 'User One', role: 'Role A', roleId: 'ra', accessProfile: 'foo', accessProfileId: 'af', entitlement: 'write', entitlementId: 'e2', source: 'engr db', sourceId: 's1' }),
      row({ id: '3', userId: 'u1', user: 'User One', entitlement: 'call', entitlementId: 'e3', source: 'phone app', sourceId: 's2' }),
      row({ id: '4', userId: 'u2', user: 'User Two', accessProfile: 'bar', accessProfileId: 'ab', entitlement: 'read-only', entitlementId: 'e4', source: 'engr db', sourceId: 's1' }),
    ]
    const counts = computeAccessCounts(deriveAccessGraph(rows))
    expect(counts).toEqual({ users: 2, accessItems: 4, sources: 2 })
  })

  it('counts a degenerate user-only row as one user with no access items or sources', () => {
    // An all-blank `access`-kind row yields just the user node (no leaf).
    const counts = computeAccessCounts(
      deriveAccessGraph([row({ userId: 'u9', user: 'Lonely', unresolved: true })]),
    )
    expect(counts).toEqual({ users: 1, accessItems: 0, sources: 0 })
  })
})
