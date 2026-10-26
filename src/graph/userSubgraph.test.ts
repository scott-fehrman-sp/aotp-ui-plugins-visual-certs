import { describe, expect, it } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import {
  buildFixtureGraph,
  fixtureItems,
  reviewItem,
} from '../test/reviewStatusFixture'
import { userSubgraph } from './userSubgraph'

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

/** Two users with non-overlapping access, for the isolation assertions. */
function twoUsers(): AccessMatrixRowVM[] {
  return [
    // User One: role → AP → ent → source, plus a direct ent on another source.
    row({ id: '1', userId: 'u1', user: 'User One', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
    row({ id: '2', userId: 'u1', user: 'User One', entitlement: 'read', entitlementId: 'e2', source: 'phone app', sourceId: 's2' }),
    // User Two: a separate AP → ent → source chain.
    row({ id: '3', userId: 'u2', user: 'User Two', accessProfile: 'bar', accessProfileId: 'ap-bar', entitlement: 'write', entitlementId: 'e3', source: 'accounting db', sourceId: 's3' }),
  ]
}

describe('userSubgraph', () => {
  it('returns exactly the selected user reachable nodes and traversed edges', () => {
    const graph = deriveAccessGraph(twoUsers())
    const sub = userSubgraph(graph, 'user:u1')

    const ids = new Set(sub.nodes.map((n) => n.id))
    // User One's full forward reach.
    expect(ids).toEqual(
      new Set([
        'user:u1',
        'role:role-a',
        'accessProfile:ap-foo',
        'entitlement:e1',
        'source:s1',
        'entitlement:e2',
        'source:s2',
      ]),
    )
    // Every kept edge has both endpoints in the kept node set.
    for (const edge of sub.edges) {
      expect(ids.has(edge.from)).toBe(true)
      expect(ids.has(edge.to)).toBe(true)
    }
    // Edges match the full graph's edges restricted to kept nodes.
    const expectedEdges = graph.edges.filter(
      (e) => ids.has(e.from) && ids.has(e.to),
    )
    expect(sub.edges).toEqual(expectedEdges)
  })

  it('excludes the other user nodes and edges (isolation)', () => {
    const graph = deriveAccessGraph(twoUsers())
    const sub = userSubgraph(graph, 'user:u1')

    const ids = new Set(sub.nodes.map((n) => n.id))
    // None of User Two's chain leaks in.
    expect(ids.has('user:u2')).toBe(false)
    expect(ids.has('accessProfile:ap-bar')).toBe(false)
    expect(ids.has('entitlement:e3')).toBe(false)
    expect(ids.has('source:s3')).toBe(false)
    for (const edge of sub.edges) {
      expect(edge.from).not.toBe('user:u2')
      expect(edge.to).not.toBe('user:u2')
    }
  })

  it('counts only this user’s visible entitlement links on a shared attribute', () => {
    const graph = deriveAccessGraph([
      row({ id: '1', userId: 'u1', entitlement: 'read', entitlementId: 'e1', entitlementAttribute: 'memberOf', source: 'directory', sourceId: 's1' }),
      row({ id: '2', userId: 'u1', entitlement: 'write', entitlementId: 'e2', entitlementAttribute: 'memberOf', source: 'directory', sourceId: 's1' }),
      row({ id: '3', userId: 'u2', user: 'User Two', entitlement: 'admin', entitlementId: 'e3', entitlementAttribute: 'memberOf', source: 'directory', sourceId: 's1' }),
    ])
    const attributeId = 'attribute:s1:memberOf'
    expect(graph.nodes.find((node) => node.id === attributeId)?.detail?.entitlementCount).toBe(
      '3',
    )

    const sub = userSubgraph(graph, 'user:u1')
    expect(sub.nodes.find((node) => node.id === attributeId)?.detail?.entitlementCount).toBe('2')
    expect(
      sub.edges.filter((edge) => edge.to === attributeId && edge.from.startsWith('entitlement:')),
    ).toHaveLength(2)
  })

  it('returns just the single user node for a user with no outgoing edges', () => {
    // A degenerate all-blank-leaf `access`-kind row contributes only the user.
    const graph = deriveAccessGraph([row({ userId: 'u1', user: 'User One' })])
    const sub = userSubgraph(graph, 'user:u1')

    expect(sub.nodes).toHaveLength(1)
    expect(sub.nodes[0]?.id).toBe('user:u1')
    expect(sub.edges).toEqual([])
  })

  it('returns an empty graph for an unknown node id', () => {
    const graph = deriveAccessGraph(twoUsers())
    const sub = userSubgraph(graph, 'user:does-not-exist')

    expect(sub.nodes).toEqual([])
    expect(sub.edges).toEqual([])
  })

  it('does not mutate the input graph', () => {
    const graph = deriveAccessGraph(twoUsers())
    const nodeCount = graph.nodes.length
    const edgeCount = graph.edges.length
    userSubgraph(graph, 'user:u1')
    expect(graph.nodes).toHaveLength(nodeCount)
    expect(graph.edges).toHaveLength(edgeCount)
  })
})

describe('userSubgraph review status (shared fixture)', () => {
  const nodeStatus = (sub: ReturnType<typeof userSubgraph>, id: string) =>
    sub.nodes.find((n) => n.id === id)?.reviewStatus
  const edgeStatus = (sub: ReturnType<typeof userSubgraph>, to: string, user: string) =>
    sub.edges.find((e) => e.from === user && e.to === to)?.reviewStatus

  it("stamps node status only from this user's first-level edge (no cross-user leak)", async () => {
    const graph = await buildFixtureGraph()
    const a = userSubgraph(graph, 'user:u-a')
    const b = userSubgraph(graph, 'user:u-b')

    // Both users hold e-login and ap-bill with different statuses.
    expect(nodeStatus(a, 'entitlement:e-login')).toBe('approved')
    expect(nodeStatus(b, 'entitlement:e-login')).toBe('needsReview')
    expect(nodeStatus(a, 'accessProfile:ap-bill')).toBe('needsReview')
    expect(nodeStatus(b, 'accessProfile:ap-bill')).toBe('reassigned')
    // And each matches its own user edge.
    expect(edgeStatus(a, 'entitlement:e-login', 'user:u-a')).toBe('approved')
    expect(edgeStatus(b, 'accessProfile:ap-bill', 'user:u-b')).toBe('reassigned')
  })

  it("a nested-only node carries no status in another user's drill-down", async () => {
    // User C holds e-write DIRECTLY (approved). For user A, e-write is only
    // reachable nested under role-a -> ap-foo, so it must not carry C's status.
    const items = [
      ...fixtureItems(),
      reviewItem({
        id: 'c-write',
        identityId: 'u-c',
        personName: 'Carol Clark',
        accessKind: 'entitlement',
        accessId: 'e-write',
        accessName: 'Write',
        completed: true,
        decision: 'APPROVE',
      }),
    ]
    const graph = await buildFixtureGraph(items)
    const a = userSubgraph(graph, 'user:u-a')
    expect(a.nodes.some((n) => n.id === 'entitlement:e-write')).toBe(true)
    expect(nodeStatus(a, 'entitlement:e-write')).toBeUndefined()
    // Deeper nodes of user A's items carry no status either.
    expect(nodeStatus(a, 'entitlement:e-pay')).toBeUndefined()
    expect(nodeStatus(a, 'accessProfile:ap-foo')).toBeUndefined()
    expect(nodeStatus(a, 'source:s-erp')).toBeUndefined()
    // ... while C's own drill-down does carry it.
    expect(nodeStatus(userSubgraph(graph, 'user:u-c'), 'entitlement:e-write')).toBe(
      'approved',
    )
  })

  it('node status always equals its incoming user edge status across a mixed fixture', async () => {
    const graph = await buildFixtureGraph()
    for (const userId of ['user:u-a', 'user:u-b']) {
      const sub = userSubgraph(graph, userId)
      for (const node of sub.nodes) {
        const incoming = sub.edges.find((e) => e.from === userId && e.to === node.id)
        expect(node.reviewStatus, `${userId} -> ${node.id}`).toBe(
          incoming?.reviewStatus,
        )
      }
    }
    // The fixture really does exercise all four statuses for user A.
    const a = userSubgraph(graph, 'user:u-a')
    const statuses = new Set(
      a.edges.filter((e) => e.from === 'user:u-a').map((e) => e.reviewStatus),
    )
    expect(statuses).toEqual(
      new Set(['needsReview', 'approved', 'revoked', 'reassigned']),
    )
    // e-read is held directly AND nested: its node status is the direct edge's.
    expect(nodeStatus(a, 'entitlement:e-read')).toBe('approved')
  })
})
