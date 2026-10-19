import { describe, expect, it } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import type { AccessMatrixRowVM } from '../sailpoint/types'
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
