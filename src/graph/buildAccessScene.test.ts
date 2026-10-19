import { describe, expect, it } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import { buildAccessScene } from './buildAccessScene'

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

/** The worked example from the user's request: one user, a role, an AP, a direct ent. */
function workedExample(): AccessMatrixRowVM[] {
  return [
    row({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
    row({ id: '2', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'write', entitlementId: 'e2', source: 'engr db', sourceId: 's1' }),
    row({ id: '3', role: 'Role A', roleId: 'role-a', accessProfile: '', entitlement: 'delete', entitlementId: 'e3', source: 'engr db', sourceId: 's1' }),
    row({ id: '4', accessProfile: 'bar', accessProfileId: 'ap-bar', entitlement: 'read', entitlementId: 'e4', source: 'accounting db', sourceId: 's2' }),
    row({ id: '5', accessProfile: 'bar', accessProfileId: 'ap-bar', entitlement: 'search', entitlementId: 'e5', source: 'accounting db', sourceId: 's2' }),
    row({ id: '6', entitlement: 'read', entitlementId: 'e6', source: 'phone app', sourceId: 's3' }),
  ]
}

describe('buildAccessScene', () => {
  it('lays out a full 5-layer path as user→role→accessProfile→entitlement→source', () => {
    // A single row with every level present yields exactly those 5 nodes.
    const graph = deriveAccessGraph([
      row({
        id: '1',
        role: 'Role A',
        roleId: 'role-a',
        accessProfile: 'foo',
        accessProfileId: 'ap-foo',
        entitlement: 'read',
        entitlementId: 'e1',
        source: 'engr db',
        sourceId: 's1',
      }),
    ])
    const scene = buildAccessScene(graph, 'LR')

    expect(scene.nodes).toHaveLength(5)
    const byId = new Map(scene.nodes.map((n) => [n.id, n]))
    expect(byId.get('user:u1')?.data.kind).toBe('user')
    expect(byId.get('role:role-a')?.data.kind).toBe('role')
    expect(byId.get('accessProfile:ap-foo')?.data.kind).toBe('accessProfile')
    expect(byId.get('entitlement:e1')?.data.kind).toBe('entitlement')
    expect(byId.get('source:s1')?.data.kind).toBe('source')
    // The chain has 4 edges connecting the 5 consecutive levels.
    expect(scene.edges).toHaveLength(4)
  })

  it('lays out a direct-entitlement row as a 3-node user→entitlement→source path', () => {
    const graph = deriveAccessGraph([
      row({ id: '6', entitlement: 'read', entitlementId: 'e6', source: 'phone app', sourceId: 's3' }),
    ])
    const scene = buildAccessScene(graph, 'LR')

    expect(scene.nodes.map((n) => n.data.kind).sort()).toEqual([
      'entitlement',
      'source',
      'user',
    ])
    // No role/AP nodes; exactly two edges (user→ent, ent→source).
    expect(scene.edges).toHaveLength(2)
    const ids = new Set(scene.nodes.map((n) => n.id))
    expect(ids.has('role:role-a')).toBe(false)
  })

  it('maps every graph edge, with endpoints that line up with the graph', () => {
    const graph = deriveAccessGraph(workedExample())
    const scene = buildAccessScene(graph, 'LR')

    expect(scene.edges).toHaveLength(graph.edges.length)
    const nodeIds = new Set(scene.nodes.map((n) => n.id))
    for (const edge of scene.edges) {
      expect(nodeIds.has(edge.source)).toBe(true)
      expect(nodeIds.has(edge.target)).toBe(true)
    }
    // Each scene edge corresponds to a derived graph edge (from→to).
    const graphPairs = new Set(graph.edges.map((e) => `${e.from}|${e.to}`))
    for (const edge of scene.edges) {
      expect(graphPairs.has(`${edge.source}|${edge.target}`)).toBe(true)
    }
  })

  it('produces finite dagre positions for every node in both rankdirs', () => {
    const graph = deriveAccessGraph(workedExample())
    for (const rankdir of ['LR', 'TB'] as const) {
      const scene = buildAccessScene(graph, rankdir)
      expect(scene.nodes.length).toBeGreaterThan(0)
      for (const node of scene.nodes) {
        expect(Number.isFinite(node.position.x)).toBe(true)
        expect(Number.isFinite(node.position.y)).toBe(true)
      }
    }
  })

  it('returns an empty scene for an empty graph', () => {
    const scene = buildAccessScene({ nodes: [], edges: [] }, 'LR')
    expect(scene.nodes).toEqual([])
    expect(scene.edges).toEqual([])
  })
})
