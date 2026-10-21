import { describe, expect, it } from 'vitest'
import type { AccessGraphData } from '../sailpoint/types'
import { buildFixtureGraph, statusSubgraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { buildAccessScene } from './buildAccessScene'
import { isReferenceNode, isStatusEdge, withoutReference } from './referenceFilter'
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

/** role-a{ap-foo{e1}} needsReview; e2 held directly (approved). */
function rows(): StatusRow[] {
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
      entitlement: 'login',
      entitlementId: 'e2',
      source: 'phone app',
      sourceId: 's2',
      reviewStatus: 'approved',
      accessItemKind: 'entitlement',
      accessItemId: 'e2',
    }),
  ]
}

describe('referenceFilter predicates', () => {
  it('classifies nodes and edges', () => {
    expect(isReferenceNode({ kind: 'user' })).toBe(false)
    expect(isReferenceNode({ kind: 'role' })).toBe(true)
    expect(isReferenceNode({ kind: 'role', reviewStatus: 'approved' })).toBe(false)
    expect(isStatusEdge({})).toBe(false)
    expect(isStatusEdge({ reviewStatus: 'revoked' })).toBe(true)
  })
})

describe('withoutReference', () => {
  it('keeps exactly the user, first-level nodes and status edges', () => {
    const sub = statusSubgraph(rows())
    const out = withoutReference(sub)
    expect(out.nodes.map((n) => n.label).sort()).toEqual(['Role A', 'User One', 'login'])
    expect(out.edges).toHaveLength(2)
    expect(out.edges.every((e) => e.firstLevel && e.reviewStatus)).toBe(true)
  })

  it('removes nested-only nodes, every source node and every reference edge', () => {
    const sub = statusSubgraph(rows())
    const out = withoutReference(sub)
    const kinds = out.nodes.map((n) => n.kind)
    expect(kinds).not.toContain('source')
    expect(kinds).not.toContain('accessProfile')
    expect(out.nodes.map((n) => n.label)).not.toContain('read')
    expect(out.edges.some((e) => !e.reviewStatus)).toBe(false)
  })

  it('leaves node and edge statuses unchanged', () => {
    const sub = statusSubgraph(rows())
    const out = withoutReference(sub)
    for (const node of out.nodes) {
      expect(node).toEqual(sub.nodes.find((n) => n.id === node.id))
    }
    for (const edge of out.edges) {
      expect(edge).toEqual(
        sub.edges.find((e) => e.from === edge.from && e.to === edge.to),
      )
    }
  })

  it('treats a firstLevel edge with no review status as reference (as the scene does)', () => {
    const graph: AccessGraphData = {
      nodes: [
        { id: 'user:u1', kind: 'user', label: 'User One' },
        { id: 'role:r', kind: 'role', label: 'Unreviewed' },
      ],
      edges: [{ from: 'user:u1', to: 'role:r', pathCount: 1, firstLevel: true }],
    }
    expect(withoutReference(graph)).toEqual({
      nodes: [{ id: 'user:u1', kind: 'user', label: 'User One' }],
      edges: [],
    })
  })

  it('returns the lone user node for a degenerate subgraph', () => {
    const graph: AccessGraphData = {
      nodes: [{ id: 'user:u1', kind: 'user', label: 'User One' }],
      edges: [],
    }
    expect(withoutReference(graph)).toEqual(graph)
  })

  it('returns an empty graph for an empty graph', () => {
    expect(withoutReference({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] })
  })

  it('does not mutate its input', () => {
    const sub = statusSubgraph(rows())
    const copy = structuredClone(sub)
    withoutReference(sub)
    expect(sub).toEqual(copy)
  })

  it('feeds a scene with no reference nodes or edges', () => {
    const scene = buildAccessScene(withoutReference(statusSubgraph(rows())), 'LR')
    expect(scene.nodes.some((n) => n.data.reference)).toBe(false)
    expect(scene.edges.some((e) => e.className?.includes('vc-graph-edge-reference'))).toBe(false)
    expect(scene.nodes).toHaveLength(3)
    expect(scene.edges).toHaveLength(2)
  })

  it('keeps a node that is both first-level and nested (fixture user A: e-read)', async () => {
    const graph = await buildFixtureGraph()
    const sub = userSubgraph(graph, 'user:u-a')
    // e-read is reachable nested (role-a -> ap-foo -> e-read) AND held directly.
    const nested = sub.edges.filter((e) => e.to === 'entitlement:e-read' && !e.firstLevel)
    expect(nested.length).toBeGreaterThan(0)

    const out = withoutReference(sub)
    const read = out.nodes.find((n) => n.id === 'entitlement:e-read')
    expect(read?.reviewStatus).toBe('approved')
    // Its nested incoming edge is dropped; only the status edge from the user stays.
    const incoming = out.edges.filter((e) => e.to === 'entitlement:e-read')
    expect(incoming).toHaveLength(1)
    expect(incoming[0].from).toBe('user:u-a')
    // Every other kept node is first-level; no source and no nested-only node.
    expect(out.nodes.some((n) => n.kind === 'source')).toBe(false)
    expect(out.nodes.some((n) => n.id === 'entitlement:e-write')).toBe(false)
    expect(out.nodes.some((n) => n.id === 'accessProfile:ap-foo')).toBe(false)
  })
})
