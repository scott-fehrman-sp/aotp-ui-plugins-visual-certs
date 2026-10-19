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

  it('threads node detail (description / department / location) onto scene node data', () => {
    const graph = deriveAccessGraph([
      row({
        id: '1',
        userId: 'u1',
        user: 'User One',
        userDepartment: 'Engineering',
        userLocation: 'Austin',
        role: 'Role A',
        roleId: 'role-a',
        roleDescription: 'Role A description',
        entitlement: 'read',
        entitlementId: 'e1',
        source: 'engr db',
        sourceId: 's1',
        sourceDescription: 'Engineering database',
      }),
    ])
    const scene = buildAccessScene(graph, 'LR')
    const byId = new Map(scene.nodes.map((n) => [n.id, n]))
    expect(byId.get('user:u1')?.data.detail).toEqual({
      department: 'Engineering',
      location: 'Austin',
    })
    expect(byId.get('role:role-a')?.data.detail).toEqual({
      description: 'Role A description',
    })
    expect(byId.get('source:s1')?.data.detail).toEqual({
      description: 'Engineering database',
    })
  })

  it('carries pathCount on each edge via the custom count-badge edge type', () => {
    // The worked example reuses the user→Role A and Role A→foo hops across
    // multiple rows, so those edges have pathCount > 1 — the data that drives
    // the badge + its hover tooltip.
    const graph = deriveAccessGraph(workedExample())
    const scene = buildAccessScene(graph, 'LR')

    for (const edge of scene.edges) {
      expect(edge.type).toBe('accessCount')
      const pathCount = (edge.data as { pathCount: number }).pathCount
      expect(Number.isInteger(pathCount)).toBe(true)
      expect(pathCount).toBeGreaterThanOrEqual(1)
    }
    // At least one shared edge exists in the worked example (user→Role A is
    // traversed by the three Role A rows).
    expect(
      scene.edges.some((e) => (e.data as { pathCount: number }).pathCount > 1),
    ).toBe(true)
  })

  it('pins each kind to its own column in LR (same x per kind, ordered user→source)', () => {
    const graph = deriveAccessGraph(workedExample())
    const scene = buildAccessScene(graph, 'LR')

    // Every node of a given kind shares one x (its column), regardless of how
    // many hops its path took (direct `read`/e6 and role-path `read`/e1 are
    // both entitlements and must share the entitlement column).
    const xByKind = new Map<string, Set<number>>()
    for (const node of scene.nodes) {
      const set = xByKind.get(node.data.kind) ?? new Set<number>()
      set.add(node.position.x)
      xByKind.set(node.data.kind, set)
    }
    for (const [, xs] of xByKind) expect(xs.size).toBe(1)

    // Columns are strictly increasing in layer order.
    const colX = (kind: string) => [...(xByKind.get(kind) ?? [])][0]
    expect(colX('user')).toBeLessThan(colX('role'))
    expect(colX('role')).toBeLessThan(colX('accessProfile'))
    expect(colX('accessProfile')).toBeLessThan(colX('entitlement'))
    expect(colX('entitlement')).toBeLessThan(colX('source'))
  })

  it('pins each kind to its own row in TB (same y per kind, ordered user→source)', () => {
    const graph = deriveAccessGraph(workedExample())
    const scene = buildAccessScene(graph, 'TB')

    const yByKind = new Map<string, Set<number>>()
    for (const node of scene.nodes) {
      const set = yByKind.get(node.data.kind) ?? new Set<number>()
      set.add(node.position.y)
      yByKind.set(node.data.kind, set)
    }
    for (const [, ys] of yByKind) expect(ys.size).toBe(1)

    const rowY = (kind: string) => [...(yByKind.get(kind) ?? [])][0]
    expect(rowY('user')).toBeLessThan(rowY('role'))
    expect(rowY('role')).toBeLessThan(rowY('accessProfile'))
    expect(rowY('accessProfile')).toBeLessThan(rowY('entitlement'))
    expect(rowY('entitlement')).toBeLessThan(rowY('source'))
  })

  it('does not overlap nodes within a kind lane, even when reached by different path lengths', () => {
    // Mixes entitlements reached directly (user→ent, short) with entitlements
    // reached via role→AP (long). Before de-overlapping, dagre gave these the
    // same cross-axis coord because they lived on different ranks, so the cards
    // stacked on top of each other. Assert every same-lane pair is separated by
    // at least the card's cross-axis extent in BOTH rankdirs.
    const rows: AccessMatrixRowVM[] = [
      row({ id: 'a', role: 'R', roleId: 'r', accessProfile: 'AP', accessProfileId: 'ap', entitlement: 'e-long-1', entitlementId: 'l1', source: 'src', sourceId: 's' }),
      row({ id: 'b', role: 'R', roleId: 'r', accessProfile: 'AP', accessProfileId: 'ap', entitlement: 'e-long-2', entitlementId: 'l2', source: 'src', sourceId: 's' }),
      row({ id: 'c', entitlement: 'e-direct-1', entitlementId: 'd1', source: 'src', sourceId: 's' }),
      row({ id: 'd', entitlement: 'e-direct-2', entitlementId: 'd2', source: 'src', sourceId: 's' }),
      row({ id: 'e', entitlement: 'e-direct-3', entitlementId: 'd3', source: 'src', sourceId: 's' }),
    ]
    const graph = deriveAccessGraph(rows)

    for (const rankdir of ['LR', 'TB'] as const) {
      const scene = buildAccessScene(graph, rankdir)
      // Group placed nodes by kind and check pairwise cross-axis separation.
      const vertical = rankdir === 'TB'
      // cross-axis extent: height stacks in LR columns, width in TB rows.
      const extent = vertical ? 200 : 64 // NODE_WIDTH : NODE_HEIGHT
      const laneCoord = (n: (typeof scene.nodes)[number]) =>
        vertical ? n.position.x : n.position.y
      const lanes = new Map<string, number[]>()
      for (const n of scene.nodes) {
        const list = lanes.get(n.data.kind) ?? []
        list.push(laneCoord(n))
        lanes.set(n.data.kind, list)
      }
      for (const coords of lanes.values()) {
        const sorted = [...coords].sort((x, y) => x - y)
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(extent)
        }
      }
    }
  })
})
