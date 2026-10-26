import { describe, expect, it } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import { statusSubgraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { buildAccessScene, NODE_USER_HEIGHT } from './buildAccessScene'
import { withoutReference } from './referenceFilter'

function row(overrides: Partial<StatusRow>): StatusRow {
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
      roleId: 'role-a',
    })
    expect(byId.get('source:s1')?.data.detail).toEqual({
      description: 'Engineering database',
      sourceId: 's1',
    })
  })

  it('renders no count badge: no accessCount edge type, no pathCount data, no count label', () => {
    // The drill-down rework removed the edge count badge entirely. Edges are now
    // plain built-in React Flow edges with no custom type, no pathCount payload,
    // and no numeric label.
    const graph = deriveAccessGraph(workedExample())
    const scene = buildAccessScene(graph, 'LR')

    for (const edge of scene.edges) {
      expect(edge.type).not.toBe('accessCount')
      expect((edge.data as { pathCount?: number } | undefined)?.pathCount).toBeUndefined()
      expect(edge.label).toBeUndefined()
    }
  })

  it('marks the user→access-item edge by review status and leaves deeper edges neutral', () => {
    // A role item that still needs review: the user→role edge carries the
    // needsReview marker (data + class + dashed amber stroke); role→AP,
    // AP→entitlement, entitlement→source stay neutral.
    const graph = statusSubgraph([
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
        reviewStatus: 'needsReview',
        accessItemKind: 'role',
        accessItemId: 'role-a',
      }),
    ])
    const scene = buildAccessScene(graph, 'LR')
    const edgeBetween = (from: string, to: string) =>
      scene.edges.find((e) => e.source === from && e.target === to)

    const userToRole = edgeBetween('user:u1', 'role:role-a')
    expect((userToRole?.data as { reviewStatus?: string } | undefined)?.reviewStatus).toBe(
      'needsReview',
    )
    expect(userToRole?.className).toContain('vc-graph-edge-needsReview')
    expect(userToRole?.style?.stroke).toBe('var(--vc-warn)')
    expect(userToRole?.style?.strokeDasharray).toBe('6 4')

    // Deeper hops carry no review status and no status class: they are
    // reference-only hairlines.
    for (const [from, to] of [
      ['role:role-a', 'accessProfile:ap-foo'],
      ['accessProfile:ap-foo', 'entitlement:e1'],
      ['entitlement:e1', 'source:s1'],
    ] as const) {
      const edge = edgeBetween(from, to)
      expect((edge?.data as { reviewStatus?: string } | undefined)?.reviewStatus).toBeUndefined()
      expect(edge?.className).toBe('vc-graph-edge-reference')
    }
  })

  /** Role-a{ap-foo{e1}} needsReview, e1 held directly (approved), plus a source. */
  function referenceRows(): StatusRow[] {
    return [
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
        reviewStatus: 'needsReview',
        accessItemKind: 'role',
        accessItemId: 'role-a',
      }),
      row({
        id: '2',
        entitlement: 'read',
        entitlementId: 'e1',
        source: 'engr db',
        sourceId: 's1',
        reviewStatus: 'approved',
        accessItemKind: 'entitlement',
        accessItemId: 'e1',
      }),
    ]
  }

  it('renders status edges above reference edges (zIndex)', () => {
    const scene = buildAccessScene(statusSubgraph(referenceRows()), 'LR')
    const status = scene.edges.filter((e) => e.className?.includes('vc-graph-edge-status'))
    const reference = scene.edges.filter((e) => e.className === 'vc-graph-edge-reference')
    expect(status).toHaveLength(2)
    expect(reference.length).toBeGreaterThan(0)
    expect(status.length + reference.length).toBe(scene.edges.length)
    for (const edge of status) expect(edge.zIndex).toBe(1)
    for (const edge of reference) expect(edge.zIndex).toBe(0)
  })

  it('stacks every node above the status edge layer so lines never cross a card', () => {
    const scene = buildAccessScene(statusSubgraph(referenceRows()), 'LR')
    const maxEdgeZ = Math.max(...scene.edges.map((e) => e.zIndex ?? 0))
    expect(scene.nodes.length).toBeGreaterThan(0)
    for (const node of scene.nodes) expect(node.zIndex).toBeGreaterThan(maxEdgeZ)
  })

  it('renders deeper edges as muted neutral reference hairlines', () => {
    const scene = buildAccessScene(statusSubgraph(referenceRows()), 'LR')
    const nested = scene.edges.find(
      (e) => e.source === 'accessProfile:ap-foo' && e.target === 'entitlement:e1',
    )
    expect(nested?.className).toBe('vc-graph-edge-reference')
    expect(nested?.style?.stroke).toBe('var(--edge)')
    expect(nested?.style?.strokeWidth).toBe(1)
    expect(nested?.style?.strokeDasharray).toBeUndefined()
    expect(Number(nested?.style?.opacity)).toBeLessThan(1)
    expect(nested?.data).toEqual({ reference: true })
  })

  it('marks nested-only nodes reference and first-level nodes not', () => {
    const scene = buildAccessScene(statusSubgraph(referenceRows()), 'LR')
    const byId = new Map(scene.nodes.map((n) => [n.id, n]))
    expect(byId.get('user:u1')?.data.reference).toBe(false)
    expect(byId.get('role:role-a')?.data.reference).toBe(false)
    expect(byId.get('accessProfile:ap-foo')?.data.reference).toBe(true)
    expect(byId.get('source:s1')?.data.reference).toBe(true)
  })

  it('a node both first-level and nested keeps its status and its nested incoming edge is reference', () => {
    const scene = buildAccessScene(statusSubgraph(referenceRows()), 'LR')
    const e1 = scene.nodes.find((n) => n.id === 'entitlement:e1')
    expect(e1?.data.reviewStatus).toBe('approved')
    expect(e1?.data.reference).toBe(false)
    const direct = scene.edges.find((e) => e.source === 'user:u1' && e.target === 'entitlement:e1')
    expect(direct?.className).toContain('vc-graph-edge-approved')
    const nested = scene.edges.find(
      (e) => e.source === 'accessProfile:ap-foo' && e.target === 'entitlement:e1',
    )
    expect(nested?.className).toBe('vc-graph-edge-reference')
  })

  it('draws an approved user→access-item edge as a solid green stroke with the status marker', () => {
    const graph = statusSubgraph([
      row({
        id: '1',
        entitlement: 'read',
        entitlementId: 'e6',
        source: 'phone app',
        sourceId: 's3',
        reviewStatus: 'approved',
        accessItemKind: 'entitlement',
        accessItemId: 'e6',
      }),
    ])
    const scene = buildAccessScene(graph, 'LR')
    const userToEnt = scene.edges.find(
      (e) => e.source === 'user:u1' && e.target === 'entitlement:e6',
    )
    expect((userToEnt?.data as { reviewStatus?: string } | undefined)?.reviewStatus).toBe(
      'approved',
    )
    expect(userToEnt?.className).toContain('vc-graph-edge-approved')
    expect(userToEnt?.style?.stroke).toBe('var(--vc-allow)')
    expect(userToEnt?.style?.strokeDasharray).toBeUndefined()
  })

  it('draws a revoked user→access-item edge as a solid red stroke with the status marker', () => {
    const graph = statusSubgraph([
      row({
        id: '1',
        entitlement: 'read',
        entitlementId: 'e6',
        source: 'phone app',
        sourceId: 's3',
        reviewStatus: 'revoked',
        accessItemKind: 'entitlement',
        accessItemId: 'e6',
      }),
    ])
    const scene = buildAccessScene(graph, 'LR')
    const userToEnt = scene.edges.find(
      (e) => e.source === 'user:u1' && e.target === 'entitlement:e6',
    )
    expect((userToEnt?.data as { reviewStatus?: string } | undefined)?.reviewStatus).toBe(
      'revoked',
    )
    expect(userToEnt?.className).toContain('vc-graph-edge-revoked')
    expect(userToEnt?.style?.stroke).toBe('var(--vc-deny)')
    expect(userToEnt?.style?.strokeDasharray).toBeUndefined()
  })

  it('draws a reassigned user→access-item edge as a dotted blue stroke with the status marker', () => {
    const graph = statusSubgraph([
      row({
        id: '1',
        role: 'Role A',
        roleId: 'role-a',
        entitlement: 'read',
        entitlementId: 'e1',
        source: 'engr db',
        sourceId: 's1',
        reviewStatus: 'reassigned',
        accessItemKind: 'role',
        accessItemId: 'role-a',
      }),
    ])
    const scene = buildAccessScene(graph, 'LR')
    const userToRole = scene.edges.find(
      (e) => e.source === 'user:u1' && e.target === 'role:role-a',
    )
    expect((userToRole?.data as { reviewStatus?: string } | undefined)?.reviewStatus).toBe(
      'reassigned',
    )
    expect(userToRole?.className).toContain('vc-graph-edge-reassigned')
    expect(userToRole?.style?.stroke).toBe('var(--vc-accent)')
    expect(userToRole?.style?.strokeDasharray).toBe('2 3')
  })

  it('threads review status onto the access-item scene node data', () => {
    const graph = statusSubgraph([
      row({
        id: '1',
        role: 'Role A',
        roleId: 'role-a',
        entitlement: 'read',
        entitlementId: 'e1',
        source: 'engr db',
        sourceId: 's1',
        reviewStatus: 'needsReview',
        accessItemKind: 'role',
        accessItemId: 'role-a',
      }),
    ])
    const scene = buildAccessScene(graph, 'LR')
    const byId = new Map(scene.nodes.map((n) => [n.id, n]))
    expect(byId.get('role:role-a')?.data.reviewStatus).toBe('needsReview')
    // User, entitlement, source nodes carry no status.
    expect(byId.get('user:u1')?.data.reviewStatus).toBeUndefined()
    expect(byId.get('entitlement:e1')?.data.reviewStatus).toBeUndefined()
    expect(byId.get('source:s1')?.data.reviewStatus).toBeUndefined()
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

  it('puts the attribute lane between entitlement and source, in both layouts', () => {
    const graph = deriveAccessGraph([
      row({
        id: '1',
        entitlement: 'read',
        entitlementId: 'e1',
        entitlementAttribute: 'memberOf',
        source: 'engr db',
        sourceId: 's1',
        accessItemKind: 'entitlement',
        accessItemId: 'e1',
        accessItemName: 'read',
      }),
      row({
        id: '2',
        entitlement: 'write',
        entitlementId: 'e2',
        entitlementAttribute: 'memberOf',
        source: 'engr db',
        sourceId: 's1',
        accessItemKind: 'entitlement',
        accessItemId: 'e2',
        accessItemName: 'write',
      }),
    ])
    for (const rankdir of ['LR', 'TB'] as const) {
      const scene = buildAccessScene(graph, rankdir)
      const axis = rankdir === 'LR' ? 'x' : 'y'
      const at = (kind: string) =>
        scene.nodes.find((node) => node.data.kind === kind)!.position[axis]
      expect(at('entitlement')).toBeLessThan(at('attribute'))
      expect(at('attribute')).toBeLessThan(at('source'))
      const entitlementAxis = new Set(
        scene.nodes
          .filter((node) => node.data.kind === 'entitlement')
          .map((node) => node.position[axis]),
      )
      expect(entitlementAxis.size).toBe(1)
    }
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

  /** Rows mixing direct entitlements with role→AP→entitlement paths (lane overlap case). */
  function mixedLaneRows(): AccessMatrixRowVM[] {
    return [
      row({ id: 'a', role: 'R', roleId: 'r', accessProfile: 'AP', accessProfileId: 'ap', entitlement: 'e-long-1', entitlementId: 'l1', source: 'src', sourceId: 's' }),
      row({ id: 'b', role: 'R', roleId: 'r', accessProfile: 'AP', accessProfileId: 'ap', entitlement: 'e-long-2', entitlementId: 'l2', source: 'src', sourceId: 's' }),
      row({ id: 'c', entitlement: 'e-direct-1', entitlementId: 'd1', source: 'src', sourceId: 's' }),
      row({ id: 'd', entitlement: 'e-direct-2', entitlementId: 'd2', source: 'src', sourceId: 's' }),
      row({ id: 'e', entitlement: 'e-direct-3', entitlementId: 'd3', source: 'src', sourceId: 's' }),
    ]
  }

  /**
   * Golden node positions + edge ids for shown (lanes) mode. Rank-axis bands
   * (columns in LR, rows in TB) and edge ids are fixed by the layer order; the
   * cross-axis positions reflect the A→Z within-lane sort by display name
   * (ties broken by id). Recapture these only when that ordering or the lane
   * geometry intentionally changes.
   */
  const GOLDEN: Record<
    string,
    { nodes: Record<string, [number, number]>; edges: string[] }
  > = {
  'worked-LR': {
    nodes: { 'user:u1': [24, -32], 'role:role-a': [344, 0], 'accessProfile:ap-foo': [664, 56], 'entitlement:e1': [984, -168], 'source:s1': [1304, 0], 'entitlement:e2': [984, 280], 'entitlement:e3': [984, -280], 'accessProfile:ap-bar': [664, -56], 'entitlement:e4': [984, -56], 'source:s2': [1304, -112], 'entitlement:e5': [984, 168], 'entitlement:e6': [984, 56], 'source:s3': [1304, 112] },
    edges: ['e:user:u1:role:role-a', 'e:role:role-a:accessProfile:ap-foo', 'e:accessProfile:ap-foo:entitlement:e1', 'e:entitlement:e1:source:s1', 'e:accessProfile:ap-foo:entitlement:e2', 'e:entitlement:e2:source:s1', 'e:role:role-a:entitlement:e3', 'e:entitlement:e3:source:s1', 'e:user:u1:accessProfile:ap-bar', 'e:accessProfile:ap-bar:entitlement:e4', 'e:entitlement:e4:source:s2', 'e:accessProfile:ap-bar:entitlement:e5', 'e:entitlement:e5:source:s2', 'e:user:u1:entitlement:e6', 'e:entitlement:e6:source:s3'],
  },
  'worked-TB': {
    nodes: { 'user:u1': [0, 24], 'role:role-a': [0, 208], 'accessProfile:ap-foo': [124, 392], 'entitlement:e1': [-372, 576], 'source:s1': [0, 760], 'entitlement:e2': [620, 576], 'entitlement:e3': [-620, 576], 'accessProfile:ap-bar': [-124, 392], 'entitlement:e4': [-124, 576], 'source:s2': [-248, 760], 'entitlement:e5': [372, 576], 'entitlement:e6': [124, 576], 'source:s3': [248, 760] },
    edges: ['e:user:u1:role:role-a', 'e:role:role-a:accessProfile:ap-foo', 'e:accessProfile:ap-foo:entitlement:e1', 'e:entitlement:e1:source:s1', 'e:accessProfile:ap-foo:entitlement:e2', 'e:entitlement:e2:source:s1', 'e:role:role-a:entitlement:e3', 'e:entitlement:e3:source:s1', 'e:user:u1:accessProfile:ap-bar', 'e:accessProfile:ap-bar:entitlement:e4', 'e:entitlement:e4:source:s2', 'e:accessProfile:ap-bar:entitlement:e5', 'e:entitlement:e5:source:s2', 'e:user:u1:entitlement:e6', 'e:entitlement:e6:source:s3'],
  },
  'nested-LR': {
    nodes: { 'user:u1': [24, -32], 'role:role-a': [344, 0], 'accessProfile:ap-foo': [664, 0], 'entitlement:e1': [984, 0], 'source:s1': [1304, 0] },
    edges: ['e:user:u1:role:role-a', 'e:role:role-a:accessProfile:ap-foo', 'e:accessProfile:ap-foo:entitlement:e1', 'e:entitlement:e1:source:s1', 'e:user:u1:entitlement:e1'],
  },
  'nested-TB': {
    nodes: { 'user:u1': [0, 24], 'role:role-a': [0, 208], 'accessProfile:ap-foo': [0, 392], 'entitlement:e1': [0, 576], 'source:s1': [0, 760] },
    edges: ['e:user:u1:role:role-a', 'e:role:role-a:accessProfile:ap-foo', 'e:accessProfile:ap-foo:entitlement:e1', 'e:entitlement:e1:source:s1', 'e:user:u1:entitlement:e1'],
  },
  'mixed-LR': {
    nodes: { 'user:u1': [24, -32], 'role:r': [344, 0], 'accessProfile:ap': [664, 0], 'entitlement:l1': [984, 112], 'source:s': [1304, 0], 'entitlement:l2': [984, 224], 'entitlement:d1': [984, -224], 'entitlement:d2': [984, -112], 'entitlement:d3': [984, 0] },
    edges: ['e:user:u1:role:r', 'e:role:r:accessProfile:ap', 'e:accessProfile:ap:entitlement:l1', 'e:entitlement:l1:source:s', 'e:accessProfile:ap:entitlement:l2', 'e:entitlement:l2:source:s', 'e:user:u1:entitlement:d1', 'e:entitlement:d1:source:s', 'e:user:u1:entitlement:d2', 'e:entitlement:d2:source:s', 'e:user:u1:entitlement:d3', 'e:entitlement:d3:source:s'],
  },
  'mixed-TB': {
    nodes: { 'user:u1': [0, 24], 'role:r': [0, 208], 'accessProfile:ap': [0, 392], 'entitlement:l1': [248, 576], 'source:s': [0, 760], 'entitlement:l2': [496, 576], 'entitlement:d1': [-496, 576], 'entitlement:d2': [-248, 576], 'entitlement:d3': [0, 576] },
    edges: ['e:user:u1:role:r', 'e:role:r:accessProfile:ap', 'e:accessProfile:ap:entitlement:l1', 'e:entitlement:l1:source:s', 'e:accessProfile:ap:entitlement:l2', 'e:entitlement:l2:source:s', 'e:user:u1:entitlement:d1', 'e:entitlement:d1:source:s', 'e:user:u1:entitlement:d2', 'e:entitlement:d2:source:s', 'e:user:u1:entitlement:d3', 'e:entitlement:d3:source:s'],
  },
  }

  describe('shown-mode layout is unchanged', () => {
    const inputs = () => ({
      worked: deriveAccessGraph(workedExample()),
      nested: statusSubgraph(referenceRows()),
      mixed: deriveAccessGraph(mixedLaneRows()),
    })
    for (const name of ['worked', 'nested', 'mixed'] as const) {
      for (const rankdir of ['LR', 'TB'] as const) {
        it(`${name} ${rankdir}: positions and edge ids match the golden values`, () => {
          const scene = buildAccessScene(inputs()[name], rankdir)
          const golden = GOLDEN[`${name}-${rankdir}`]
          expect(
            Object.fromEntries(
              scene.nodes.map((n) => [n.id, [n.position.x, n.position.y]]),
            ),
          ).toEqual(golden.nodes)
          expect(scene.edges.map((e) => e.id)).toEqual(golden.edges)
        })

        it(`${name} ${rankdir}: omitted / empty / singleLane:false options are identical`, () => {
          const graph = inputs()[name]
          const base = buildAccessScene(graph, rankdir)
          expect(buildAccessScene(graph, rankdir, {})).toEqual(base)
          expect(buildAccessScene(graph, rankdir, { singleLane: false })).toEqual(base)
        })
      }
    }
  })

  describe('single-lane (reference hidden) layout', () => {
    /** First-level items of mixed kind, case, and duplicate labels, plus nested lineage. */
    function mixedRows(n = 4): StatusRow[] {
      const statuses = ['needsReview', 'approved', 'revoked', 'reassigned'] as const
      const rows: StatusRow[] = [
        row({ id: 'r1', role: 'beta role', roleId: 'r2', entitlement: 'nested-a', entitlementId: 'n1', source: 'src', sourceId: 's1', reviewStatus: 'reassigned', accessItemKind: 'role', accessItemId: 'r2', accessItemName: 'beta role' }),
        row({ id: 'r2', role: 'Alpha Role', roleId: 'r1', accessProfile: 'AP-n', accessProfileId: 'ap-n', entitlement: 'nested-b', entitlementId: 'n2', source: 'src', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'r1', accessItemName: 'Alpha Role' }),
        row({ id: 'p1', accessProfile: 'Zeta AP', accessProfileId: 'ap2', entitlement: 'nested-c', entitlementId: 'n3', source: 'src', sourceId: 's1', reviewStatus: 'approved', accessItemKind: 'accessProfile', accessItemId: 'ap2', accessItemName: 'Zeta AP' }),
        row({ id: 'p2', accessProfile: 'alpha AP', accessProfileId: 'ap1', entitlement: 'nested-d', entitlementId: 'n4', source: 'src', sourceId: 's1', reviewStatus: 'revoked', accessItemKind: 'accessProfile', accessItemId: 'ap1', accessItemName: 'alpha AP' }),
      ]
      const ents: [string, string][] = [
        ['Delta', 'e-d'],
        ['charlie', 'e-c'],
        ['Same', 'e-b'],
        ['Same', 'e-a'],
        ['Bravo', 'e-x'],
        ['echo', 'e-y'],
      ]
      ents.slice(0, Math.max(0, n)).forEach(([name, id], i) => {
        rows.push(row({ id: `e${i}`, entitlement: name, entitlementId: id, source: 'src', sourceId: 's1', reviewStatus: statuses[i % 4], accessItemKind: 'entitlement', accessItemId: id, accessItemName: name }))
      })
      return rows
    }
    const hiddenGraph = (n?: number) => withoutReference(statusSubgraph(mixedRows(n)))
    const EXPECTED_ORDER = [
      'role:r1', // Alpha Role
      'role:r2', // beta role
      'accessProfile:ap1', // alpha AP
      'accessProfile:ap2', // Zeta AP
      'entitlement:e-x', // Bravo (n=6 only)
      'entitlement:e-c', // charlie
      'entitlement:e-d', // Delta
      'entitlement:e-y', // echo
      'entitlement:e-a', // Same (id tie-break: e-a < e-b)
      'entitlement:e-b', // Same
    ]
    const rankOf = (n: { position: { x: number; y: number } }, rd: 'LR' | 'TB') =>
      rd === 'LR' ? n.position.x : n.position.y
    const crossOf = (n: { position: { x: number; y: number } }, rd: 'LR' | 'TB') =>
      rd === 'LR' ? n.position.y : n.position.x

    for (const rankdir of ['LR', 'TB'] as const) {
      describe(rankdir, () => {
        const extent = rankdir === 'LR' ? 64 : 200
        const stride = extent + 48

        it('puts every first-level item in ONE lane strictly after the user', () => {
          const scene = buildAccessScene(hiddenGraph(6), rankdir, { singleLane: true })
          const user = scene.nodes.find((n) => n.data.kind === 'user')!
          const items = scene.nodes.filter((n) => n.data.kind !== 'user')
          expect(items).toHaveLength(10)
          const lane = rankOf(items[0], rankdir)
          for (const item of items) expect(rankOf(item, rankdir)).toBe(lane)
          expect(lane).toBeGreaterThan(rankOf(user, rankdir))
        })

        it('orders by kind (role, access profile, entitlement), then label case-insensitively, then id', () => {
          const scene = buildAccessScene(hiddenGraph(6), rankdir, { singleLane: true })
          const ordered = scene.nodes
            .filter((n) => n.data.kind !== 'user')
            .sort((a, b) => crossOf(a, rankdir) - crossOf(b, rankdir))
            .map((n) => n.id)
          expect(ordered).toEqual(EXPECTED_ORDER)
        })

        it('never overlaps cards: consecutive cross gap equals the stride (>= card extent)', () => {
          for (const n of [0, 1, 2, 3, 6]) {
            const scene = buildAccessScene(hiddenGraph(n), rankdir, { singleLane: true })
            const crosses = scene.nodes
              .filter((x) => x.data.kind !== 'user')
              .map((x) => crossOf(x, rankdir))
              .sort((a, b) => a - b)
            for (let i = 1; i < crosses.length; i++) {
              expect(crosses[i] - crosses[i - 1]).toBe(stride)
              expect(crosses[i] - crosses[i - 1]).toBeGreaterThanOrEqual(extent)
            }
          }
        })

        it('centers the user on the lane span (odd, even and single-item lanes)', () => {
          // 4 fixed items + n entitlements: n=0 -> 4 (even), 1 -> 5 (odd); and a one-item lane.
          const single = withoutReference(
            statusSubgraph([
              row({ id: '1', entitlement: 'only', entitlementId: 'e1', source: 's', sourceId: 's1', reviewStatus: 'approved', accessItemKind: 'entitlement', accessItemId: 'e1', accessItemName: 'only' }),
            ]),
          )
          for (const graph of [hiddenGraph(0), hiddenGraph(1), hiddenGraph(6), single]) {
            const scene = buildAccessScene(graph, rankdir, { singleLane: true })
            const user = scene.nodes.find((x) => x.data.kind === 'user')!
            const crosses = scene.nodes
              .filter((x) => x.data.kind !== 'user')
              .map((x) => crossOf(x, rankdir))
            const laneMid = (Math.min(...crosses) + Math.max(...crosses) + extent) / 2
            // The user card's CENTER sits on the lane midpoint. In LR the user
            // card is taller (its cross axis is Y), so use its own cross extent;
            // in TB the cross axis is width, unchanged from the others.
            const userExtent = rankdir === 'LR' ? NODE_USER_HEIGHT : extent
            expect(crossOf(user, rankdir) + userExtent / 2).toBeCloseTo(laneMid, 9)
          }
        })

        it('emits exactly the first-level edges with unchanged status styling and node data', () => {
          const full = statusSubgraph(mixedRows(6))
          const hidden = withoutReference(full)
          const single = buildAccessScene(hidden, rankdir, { singleLane: true })
          const lanes = buildAccessScene(full, rankdir)
          expect(single.edges.map((e) => e.id)).toEqual(
            hidden.edges.map((e) => `e:${e.from}:${e.to}`),
          )
          for (const edge of single.edges) {
            expect(edge).toEqual(lanes.edges.find((e) => e.id === edge.id))
            expect(edge.className).toContain('vc-graph-edge-status')
          }
          for (const node of single.nodes) {
            const laneNode = lanes.nodes.find((n) => n.id === node.id)!
            // Everything but the position is identical to the lanes-mode node.
            expect({ ...node, position: null }).toEqual({ ...laneNode, position: null })
            expect(node.data.reference).toBe(false)
            expect(node.zIndex).toBe(2)
          }
        })

        it('is deterministic, independent of input order, and does not mutate the input', () => {
          const graph = hiddenGraph(6)
          const before = JSON.stringify(graph)
          const a = buildAccessScene(graph, rankdir, { singleLane: true })
          const b = buildAccessScene(graph, rankdir, { singleLane: true })
          expect(b).toEqual(a)
          expect(JSON.stringify(graph)).toBe(before)
          const shuffled = {
            nodes: [...graph.nodes].reverse(),
            edges: [...graph.edges].reverse(),
          }
          const c = buildAccessScene(shuffled, rankdir, { singleLane: true })
          const positions = (scene: typeof a) =>
            Object.fromEntries(scene.nodes.map((n) => [n.id, n.position]))
          expect(positions(c)).toEqual(positions(a))
        })
      })
    }

    it('returns an empty scene for an empty graph', () => {
      expect(buildAccessScene({ nodes: [], edges: [] }, 'LR', { singleLane: true })).toEqual({
        nodes: [],
        edges: [],
      })
    })
  })

  it('stamps completion on the user node only', () => {
    const completion = { percent: 75, completed: 3, total: 4 }
    const scene = buildAccessScene(
      statusSubgraph([
        row({
          id: '1',
          role: 'Role A',
          roleId: 'role-a',
          entitlement: 'read',
          entitlementId: 'e1',
          source: 'src',
          sourceId: 's1',
          reviewStatus: 'approved',
          accessItemKind: 'role',
          accessItemId: 'role-a',
          accessItemName: 'Role A',
        }),
      ]),
      'LR',
      { completion },
    )
    const user = scene.nodes.find((n) => n.data.kind === 'user')
    expect(user?.data.completion).toEqual(completion)
    for (const node of scene.nodes) {
      if (node.data.kind !== 'user') expect(node.data.completion).toBeUndefined()
    }
  })
})
