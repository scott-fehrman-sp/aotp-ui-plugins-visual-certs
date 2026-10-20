import { describe, expect, it } from 'vitest'
import { deriveAccessGraph } from './accessGraph'
import { computeAccessCounts } from './accessCounts'
import type { AccessMatrixRowVM, ReviewItemVM } from '../sailpoint/types'

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

function item(overrides: Partial<ReviewItemVM>): ReviewItemVM {
  return {
    id: 'i',
    identityId: 'u1',
    completed: false,
    decision: null,
    reassigned: false,
    comments: null,
    personName: 'User One',
    accessName: 'A',
    accessKind: 'entitlement',
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

describe('computeAccessCounts', () => {
  it('returns all zeros for an empty graph and no items', () => {
    expect(computeAccessCounts({ nodes: [], edges: [] }, [])).toEqual({
      users: 0,
      accessItems: 0,
      sources: 0,
    })
  })

  it('counts access items as 0 while the review items are still loading (null)', () => {
    expect(computeAccessCounts({ nodes: [], edges: [] }, null).accessItems).toBe(0)
  })

  it('counts access items as the first-level review items, NOT the expanded leaf entitlements', () => {
    // User One holds ONE role (Role A) whose lineage expands to two leaf
    // entitlements, plus ONE directly-held entitlement. User Two holds ONE
    // access profile that expands to one leaf. That is 3 first-level review
    // items, but 4 distinct leaf entitlements in the expanded graph — the count
    // must be 3 because only first-level items are actionable.
    const rows: AccessMatrixRowVM[] = [
      row({ id: '1', userId: 'u1', user: 'User One', role: 'Role A', roleId: 'ra', accessProfile: 'foo', accessProfileId: 'af', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
      row({ id: '2', userId: 'u1', user: 'User One', role: 'Role A', roleId: 'ra', accessProfile: 'foo', accessProfileId: 'af', entitlement: 'write', entitlementId: 'e2', source: 'engr db', sourceId: 's1' }),
      row({ id: '3', userId: 'u1', user: 'User One', entitlement: 'call', entitlementId: 'e3', source: 'phone app', sourceId: 's2' }),
      row({ id: '4', userId: 'u2', user: 'User Two', accessProfile: 'bar', accessProfileId: 'ab', entitlement: 'read-only', entitlementId: 'e4', source: 'engr db', sourceId: 's1' }),
    ]
    const items: ReviewItemVM[] = [
      item({ id: 'i1', identityId: 'u1', accessKind: 'role', accessName: 'Role A' }),
      item({ id: 'i2', identityId: 'u1', accessKind: 'entitlement', accessName: 'call' }),
      item({ id: 'i3', identityId: 'u2', accessKind: 'accessProfile', accessName: 'bar' }),
    ]
    const graph = deriveAccessGraph(rows)

    // Sanity: the expanded graph really does hold 4 leaf entitlements.
    expect(graph.nodes.filter((n) => n.kind === 'entitlement')).toHaveLength(4)

    expect(computeAccessCounts(graph, items)).toEqual({
      users: 2,
      accessItems: 3,
      sources: 2,
    })
  })

  it('still counts a degenerate user-only graph as one user with no sources', () => {
    const graph = deriveAccessGraph([
      row({ userId: 'u9', user: 'Lonely', unresolved: true }),
    ])
    expect(
      computeAccessCounts(graph, [item({ identityId: 'u9', accessKind: 'access' })]),
    ).toEqual({ users: 1, accessItems: 1, sources: 0 })
  })
})
