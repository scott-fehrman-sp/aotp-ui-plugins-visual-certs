import { describe, expect, it } from 'vitest'
import type { AccessGraphData } from '../sailpoint/types'
import { buildFixtureGraph, statusSubgraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { NODE_HEIGHT, NODE_WIDTH, buildAccessScene } from './buildAccessScene'
import {
  completionPercent,
  isCompletedEdge,
  isCompletedStatus,
  withoutCompleted,
} from './completedFilter'
import { isReferenceNode, withoutReference } from './referenceFilter'
import { userSubgraph } from './userSubgraph'

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

const labels = (graph: AccessGraphData) => graph.nodes.map((n) => n.label).sort()
const edgePairs = (graph: AccessGraphData) =>
  graph.edges.map((e) => `${e.from}>${e.to}`).sort()

/** Example 1: completed Role A -> AP Foo -> Ent Read -> ERP; needs-review Role B -> Read. */
function example1(): StatusRow[] {
  return [
    row({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'Foo', accessProfileId: 'ap-foo', entitlement: 'Read', entitlementId: 'e-read', source: 'ERP', sourceId: 's-erp', reviewStatus: 'approved', accessItemKind: 'role', accessItemId: 'role-a' }),
    row({ id: '2', role: 'Role B', roleId: 'role-b', entitlement: 'Read', entitlementId: 'e-read', source: 'ERP', sourceId: 's-erp', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-b' }),
  ]
}

/** Example 2: entitlement E held directly (revoked) AND nested under needs-review role R. */
function example2(): StatusRow[] {
  return [
    row({ id: '1', role: 'Role R', roleId: 'role-r', entitlement: 'E', entitlementId: 'e-e', source: 'DB', sourceId: 's-db', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-r' }),
    row({ id: '2', entitlement: 'E', entitlementId: 'e-e', source: 'DB', sourceId: 's-db', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e-e' }),
  ]
}

/** One item per status: approved, revoked, reassigned, needsReview. */
function allStatuses(): StatusRow[] {
  return [
    row({ id: '1', entitlement: 'Ap', entitlementId: 'e1', source: 'S1', sourceId: 's1', reviewStatus: 'approved', accessItemKind: 'entitlement', accessItemId: 'e1' }),
    row({ id: '2', entitlement: 'Re', entitlementId: 'e2', source: 'S2', sourceId: 's2', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e2' }),
    row({ id: '3', entitlement: 'Ra', entitlementId: 'e3', source: 'S3', sourceId: 's3', reviewStatus: 'reassigned', accessItemKind: 'entitlement', accessItemId: 'e3' }),
    row({ id: '4', entitlement: 'Nr', entitlementId: 'e4', source: 'S4', sourceId: 's4', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: 'e4' }),
  ]
}

describe('completed predicates', () => {
  it('treats approved, revoked and reassigned as completed only', () => {
    expect(isCompletedStatus('approved')).toBe(true)
    expect(isCompletedStatus('revoked')).toBe(true)
    expect(isCompletedStatus('reassigned')).toBe(true)
    expect(isCompletedStatus('needsReview')).toBe(false)
    expect(isCompletedStatus(undefined)).toBe(false)
  })

  it('needs a first-level edge', () => {
    expect(isCompletedEdge({ firstLevel: true, reviewStatus: 'approved' })).toBe(true)
    expect(isCompletedEdge({ reviewStatus: 'approved' })).toBe(false)
    expect(isCompletedEdge({ firstLevel: true })).toBe(false)
    expect(isCompletedEdge({ firstLevel: true, reviewStatus: 'needsReview' })).toBe(false)
  })
})

describe('withoutCompleted', () => {
  it('hides approved, revoked and reassigned items but never needsReview', () => {
    const sub = statusSubgraph(allStatuses())
    const { graph, hiddenCount } = withoutCompleted(sub)
    expect(hiddenCount).toBe(3)
    expect(labels(graph)).toEqual(['Nr', 'S4', 'User One'])
    expect(graph.edges.every((e) => e.reviewStatus === 'needsReview' || !e.firstLevel)).toBe(true)
  })

  it('returns the same graph object when nothing is completed', () => {
    const sub = statusSubgraph([allStatuses()[3]])
    const result = withoutCompleted(sub)
    expect(result.graph).toBe(sub)
    expect(result.hiddenCount).toBe(0)
  })

  it('example 1: keeps lineage shared with a visible item, only through that item', () => {
    const sub = statusSubgraph(example1())
    const { graph, hiddenCount } = withoutCompleted(sub)
    expect(hiddenCount).toBe(1)
    expect(labels(graph)).toEqual(['ERP', 'Read', 'Role B', 'User One'])
    expect(edgePairs(graph)).toEqual(
      [
        'user:u1>role:role-b',
        'role:role-b>entitlement:e-read',
        'entitlement:e-read>source:s-erp',
      ].sort(),
    )
    // Foo is gone, and Read has only the Role B edge into it.
    expect(graph.nodes.some((n) => n.label === 'Foo')).toBe(false)
    expect(graph.edges.filter((e) => e.to === 'entitlement:e-read')).toHaveLength(1)
  })

  it('example 2: a directly held completed entitlement nested under a visible role stays as reference', () => {
    const sub = statusSubgraph(example2())
    const e = sub.nodes.find((n) => n.label === 'E')!
    expect(e.reviewStatus).toBe('revoked')
    const { graph, hiddenCount } = withoutCompleted(sub)
    expect(hiddenCount).toBe(1)
    const kept = graph.nodes.find((n) => n.label === 'E')!
    expect(kept.reviewStatus).toBeUndefined()
    expect(kept.reviewMixed).toBeUndefined()
    expect(isReferenceNode(kept)).toBe(true)
    expect(graph.edges.filter((x) => x.to === kept.id).map((x) => x.from)).toEqual([
      'role:role-r',
    ])
    expect(graph.edges.some((x) => x.from === 'user:u1' && x.to === kept.id)).toBe(false)
    // The input node keeps its status (copy, not mutation).
    expect(e.reviewStatus).toBe('revoked')
  })

  it('removes lineage and sources reachable only through hidden items', () => {
    const sub = statusSubgraph([
      ...allStatuses(),
      row({ id: '5', role: 'Role V', roleId: 'role-v', accessProfile: 'AP V', accessProfileId: 'ap-v', entitlement: 'Deep', entitlementId: 'e-deep', source: 'Hidden DB', sourceId: 's-h', reviewStatus: 'approved', accessItemKind: 'role', accessItemId: 'role-v' }),
    ])
    const { graph, hiddenCount } = withoutCompleted(sub)
    expect(hiddenCount).toBe(4)
    for (const gone of ['Role V', 'AP V', 'Deep', 'Hidden DB', 'S1', 'S2', 'S3']) {
      expect(graph.nodes.some((n) => n.label === gone)).toBe(false)
    }
    expect(graph.edges.every((e) => graph.nodes.some((n) => n.id === e.from) && graph.nodes.some((n) => n.id === e.to))).toBe(true)
  })

  it('never hides a firstLevel edge with no status, nor a mixed item (aggregates to needsReview)', () => {
    const noStatus: AccessGraphData = {
      nodes: [
        { id: 'user:u1', kind: 'user', label: 'User One' },
        { id: 'role:r', kind: 'role', label: 'Unreviewed' },
      ],
      edges: [{ from: 'user:u1', to: 'role:r', pathCount: 1, firstLevel: true }],
    }
    expect(withoutCompleted(noStatus)).toEqual({ graph: noStatus, hiddenCount: 0 })

    const mixed = statusSubgraph([
      row({ id: '1', role: 'Role M', roleId: 'role-m', entitlement: 'a', entitlementId: 'ea', reviewStatus: 'approved', accessItemKind: 'role', accessItemId: 'role-m' }),
      row({ id: '2', role: 'Role M', roleId: 'role-m', entitlement: 'b', entitlementId: 'eb', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-m' }),
    ])
    const m = mixed.nodes.find((n) => n.label === 'Role M')!
    expect(m.reviewStatus).toBe('needsReview')
    const result = withoutCompleted(mixed)
    expect(result.hiddenCount).toBe(0)
    expect(result.graph.nodes.some((n) => n.label === 'Role M')).toBe(true)
  })

  it('hiddenCount counts distinct hidden items, not nodes or edges', () => {
    const sub = statusSubgraph([
      row({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'Foo', accessProfileId: 'ap-foo', entitlement: 'r1', entitlementId: 'e1', source: 'S', sourceId: 's1', reviewStatus: 'approved', accessItemKind: 'role', accessItemId: 'role-a' }),
      row({ id: '2', role: 'Role A', roleId: 'role-a', accessProfile: 'Foo', accessProfileId: 'ap-foo', entitlement: 'r2', entitlementId: 'e2', source: 'S', sourceId: 's1', reviewStatus: 'approved', accessItemKind: 'role', accessItemId: 'role-a' }),
      row({ id: '3', role: 'Role A', roleId: 'role-a', entitlement: 'r3', entitlementId: 'e3', source: 'S', sourceId: 's1', reviewStatus: 'approved', accessItemKind: 'role', accessItemId: 'role-a' }),
    ])
    expect(sub.nodes.length).toBeGreaterThan(5)
    const { graph, hiddenCount } = withoutCompleted(sub)
    expect(hiddenCount).toBe(1)
    expect(labels(graph)).toEqual(['User One'])
  })

  it('everything completed leaves only the user node', () => {
    const rows = allStatuses().slice(0, 3)
    const { graph, hiddenCount } = withoutCompleted(statusSubgraph(rows))
    expect(graph.nodes.map((n) => n.kind)).toEqual(['user'])
    expect(graph.edges).toEqual([])
    expect(hiddenCount).toBe(3)
  })

  it('leaves degenerate and empty graphs unchanged', () => {
    const lone: AccessGraphData = {
      nodes: [{ id: 'user:u1', kind: 'user', label: 'User One' }],
      edges: [],
    }
    expect(withoutCompleted(lone)).toEqual({ graph: lone, hiddenCount: 0 })
    expect(withoutCompleted({ nodes: [], edges: [] })).toEqual({
      graph: { nodes: [], edges: [] },
      hiddenCount: 0,
    })
  })

  it('preserves relative order and the identity of unchanged nodes', () => {
    const sub = statusSubgraph(example1())
    const { graph } = withoutCompleted(sub)
    const order = (g: AccessGraphData) => g.nodes.map((n) => n.id)
    const expected = order(sub).filter((id) => order(graph).includes(id))
    expect(order(graph)).toEqual(expected)
    for (const node of graph.nodes) {
      expect(node).toBe(sub.nodes.find((n) => n.id === node.id))
    }
  })

  it('does not mutate its input, is deterministic and idempotent', () => {
    const sub = statusSubgraph(example2())
    const copy = structuredClone(sub)
    const first = withoutCompleted(sub)
    expect(sub).toEqual(copy)
    expect(withoutCompleted(sub)).toEqual(first)
    expect(withoutCompleted(first.graph).hiddenCount).toBe(0)
  })

  it('composes with withoutReference, filter-then-reference', () => {
    const sub = statusSubgraph([...example1(), ...example2().map((r) => ({ ...r, id: `x${r.id}` }))])
    const completedFirst = withoutReference(withoutCompleted(sub).graph)
    expect(labels(completedFirst)).toEqual(['Role B', 'Role R', 'User One'])
    expect(completedFirst.edges.every((e) => e.firstLevel && e.reviewStatus)).toBe(true)
    // Reference-first leaves the completed first-level items to be filtered after:
    // the same visible first level once the completed items go (E is dropped too,
    // because it is no longer first level).
    const referenceFirst = withoutCompleted(withoutReference(sub)).graph
    expect(labels(referenceFirst)).toEqual(labels(completedFirst))
    expect(edgePairs(referenceFirst)).toEqual(edgePairs(completedFirst))
  })

  it('works through the real pipeline (fixture users A and B)', async () => {
    const graph = await buildFixtureGraph()
    const alice = withoutCompleted(userSubgraph(graph, 'user:u-a'))
    // Billing (needsReview) -> Pay -> ERP stays; Role A (reassigned), Login,
    // Admin and Read (held directly, approved) go, with everything only they reach.
    expect(labels(alice.graph)).toEqual(['Alice Adams', 'Billing', 'ERP', 'Pay'])
    expect(alice.hiddenCount).toBe(4)
    const bob = withoutCompleted(userSubgraph(graph, 'user:u-b'))
    expect(labels(bob.graph)).toEqual(['Bob Brown', 'Directory', 'Login'])
    expect(bob.hiddenCount).toBe(1)
  })

  it.each(['LR', 'TB'] as const)(
    'feeds a gap-free %s scene with the lanes in order',
    (rankdir) => {
      // needs-review role, completed access profile, and needs-review
      // entitlements around a completed one.
      const sub = statusSubgraph([
        row({ id: '1', role: 'Role A', roleId: 'role-a', entitlement: 'x', entitlementId: 'e0', source: 'S', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-a' }),
        row({ id: '2', accessProfile: 'AP', accessProfileId: 'ap-1', entitlement: 'y', entitlementId: 'e9', source: 'S', sourceId: 's1', reviewStatus: 'approved', accessItemKind: 'accessProfile', accessItemId: 'ap-1' }),
        row({ id: '3', entitlement: 'one', entitlementId: 'e1', source: 'S', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: 'e1' }),
        row({ id: '4', entitlement: 'two', entitlementId: 'e2', source: 'S', sourceId: 's1', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e2' }),
        row({ id: '5', entitlement: 'three', entitlementId: 'e3', source: 'S', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: 'e3' }),
      ])
      const scene = buildAccessScene(withoutCompleted(sub).graph, rankdir)
      const axis = rankdir === 'LR' ? 'x' : 'y'
      const cross = rankdir === 'LR' ? 'y' : 'x'
      const stride = (rankdir === 'LR' ? NODE_HEIGHT : NODE_WIDTH) + 48
      const byKind = (kind: string) =>
        scene.nodes.filter((n) => n.data.kind === kind)
      const rank = (kind: string) => byKind(kind)[0].position[axis]

      expect(byKind('accessProfile')).toHaveLength(0)
      expect(rank('user')).toBeLessThan(rank('role'))
      expect(rank('role')).toBeLessThan(rank('entitlement'))
      expect(rank('entitlement')).toBeLessThan(rank('source'))
      const ents = byKind('entitlement')
        .map((n) => n.position[cross])
        .sort((a, b) => a - b)
      // Nested x plus the two remaining first-level entitlements, evenly spaced.
      expect(ents).toHaveLength(3)
      expect(ents[1] - ents[0]).toBe(stride)
      expect(ents[2] - ents[1]).toBe(stride)
    },
  )
})

describe('completionPercent', () => {
  const edge = (
    from: string,
    status?: 'needsReview' | 'approved' | 'revoked' | 'reassigned',
    firstLevel = true,
  ) => ({ from, firstLevel, reviewStatus: status })

  it('counts approved, revoked and reassigned as completed and needsReview as not', () => {
    const edges = [
      edge('user:u1', 'approved'),
      edge('user:u1', 'revoked'),
      edge('user:u1', 'reassigned'),
      edge('user:u1', 'needsReview'),
    ]
    // 3 of 4.
    expect(completionPercent(edges, 'user:u1')).toBe(75)
  })

  it('rounds to the nearest whole percent', () => {
    expect(
      completionPercent(
        [edge('user:u1', 'approved'), edge('user:u1', 'needsReview'), edge('user:u1', 'needsReview')],
        'user:u1',
      ),
    ).toBe(33)
    expect(
      completionPercent(
        [edge('user:u1', 'approved'), edge('user:u1', 'revoked'), edge('user:u1', 'needsReview')],
        'user:u1',
      ),
    ).toBe(67)
  })

  it('ignores other users, nested edges and edges with no review status', () => {
    const edges = [
      edge('user:u1', 'approved'),
      edge('user:u2', 'needsReview'),
      edge('user:u1', 'needsReview', false),
      edge('user:u1'),
    ]
    expect(completionPercent(edges, 'user:u1')).toBe(100)
    expect(completionPercent(edges, 'user:u2')).toBe(0)
  })

  it('is 0 when the user has no reviewable access items', () => {
    expect(completionPercent([], 'user:u1')).toBe(0)
  })

  it('does not change when completed edges are removed from a copy of the list', () => {
    const edges = [
      edge('user:u1', 'approved'),
      edge('user:u1', 'needsReview'),
    ]
    const visible = edges.filter((e) => e.reviewStatus === 'needsReview')
    expect(completionPercent(edges, 'user:u1')).toBe(50)
    // Counting only the still-visible edges would wrongly report 0.
    expect(completionPercent(visible, 'user:u1')).toBe(0)
    expect(completionPercent(edges, 'user:u1')).toBe(50)
  })
})
