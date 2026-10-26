import { beforeAll, describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import { buildFixtureGraph, statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import type { AccessGraphData, AccessReviewStatus } from '../sailpoint/types'
import { userSubgraph } from './userSubgraph'
import { withoutReference } from './referenceFilter'
import { CARD_Z_INDEX, buildAccessScene } from './buildAccessScene'
import {
  DIM_REFERENCE_OPACITY,
  DIM_STATUS_OPACITY,
  EMPHASIS_EDGE_Z_INDEX,
  emphasizeEdges,
} from './emphasizeEdges'
import {
  LINEAGE_EDGE_CLASS,
  LINEAGE_STROKE_WIDTH,
  SELECTED_EDGE_CLASS,
  SELECTION_STROKE_WIDTH,
  STATUS_STROKE,
  connectedEdgeIds,
  connectedNodeIds,
  highlightEdges,
  isSelectableNodeData,
  lineageEdgeIds,
  lineageNodeIds,
} from './selectEdges'

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

/**
 * role-a{ap-foo{e1}} needsReview -> s1, ap-b{e2} approved -> s2, e3 revoked
 * (direct) -> s2, e4 reassigned (direct) -> s1. e2 and e3 share the s2 edge target.
 */
function rows(): StatusRow[] {
  return [
    row({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-a', accessItemName: 'Role A' }),
    row({ id: '2', accessProfile: 'bar', accessProfileId: 'ap-b', entitlement: 'login', entitlementId: 'e2', source: 'phone app', sourceId: 's2', reviewStatus: 'approved', accessItemKind: 'accessProfile', accessItemId: 'ap-b', accessItemName: 'bar' }),
    row({ id: '3', entitlement: 'admin', entitlementId: 'e3', source: 'phone app', sourceId: 's2', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e3', accessItemName: 'admin' }),
    row({ id: '4', entitlement: 'pay', entitlementId: 'e4', source: 'engr db', sourceId: 's1', reviewStatus: 'reassigned', accessItemKind: 'entitlement', accessItemId: 'e4', accessItemName: 'pay' }),
  ]
}

const sub = () => userSubgraph(statusGraph(rows()), 'user:u1')
const isStatus = (e: Edge) => Boolean((e.data as { reviewStatus?: string } | undefined)?.reviewStatus)
const eid = (from: string, to: string) => `e:${from}:${to}`
const clone = <T,>(value: T): T => structuredClone(value)
const byId = (edges: Edge[]) => new Map(edges.map((e) => [e.id, e]))
const sorted = (ids: Iterable<string>) => [...ids].sort()
const edge = (source: string, target: string): Edge => ({ id: eid(source, target), source, target })

describe('isSelectableNodeData', () => {
  it('is true for every node except the user, including reference nodes', () => {
    expect(isSelectableNodeData({ kind: 'role', reference: false })).toBe(true)
    expect(isSelectableNodeData({ kind: 'accessProfile', reference: false })).toBe(true)
    expect(isSelectableNodeData({ kind: 'entitlement', reference: false })).toBe(true)
    expect(isSelectableNodeData({ kind: 'user', reference: false })).toBe(false)
    expect(isSelectableNodeData({ kind: 'entitlement', reference: true })).toBe(true)
    expect(isSelectableNodeData({ kind: 'attribute', reference: true })).toBe(true)
    expect(isSelectableNodeData({ kind: 'source', reference: true })).toBe(true)
  })
})

describe('lineageEdgeIds / lineageNodeIds', () => {
  const scene = buildAccessScene(sub(), 'LR')

  it('reaches every nested edge and the source edge below a role', () => {
    expect(sorted(lineageEdgeIds(scene.edges, 'role:role-a'))).toEqual(
      sorted([
        eid('role:role-a', 'accessProfile:ap-foo'),
        eid('accessProfile:ap-foo', 'entitlement:e1'),
        eid('entitlement:e1', 'source:s1'),
      ]),
    )
    expect(sorted(lineageNodeIds(scene.edges, 'role:role-a'))).toEqual(
      sorted(['accessProfile:ap-foo', 'entitlement:e1', 'source:s1']),
    )
  })

  it('reaches the entitlements and source below an access profile', () => {
    expect(sorted(lineageEdgeIds(scene.edges, 'accessProfile:ap-b'))).toEqual(
      sorted([eid('accessProfile:ap-b', 'entitlement:e2'), eid('entitlement:e2', 'source:s2')]),
    )
  })

  it('reaches only the source edge below a directly-held entitlement', () => {
    expect([...lineageEdgeIds(scene.edges, 'entitlement:e3')]).toEqual([
      eid('entitlement:e3', 'source:s2'),
    ])
  })

  it('never includes the item node, the incoming edge or other items edges', () => {
    const ids = lineageEdgeIds(scene.edges, 'role:role-a')
    expect(ids.has(eid('user:u1', 'role:role-a'))).toBe(false)
    expect(ids.has(eid('entitlement:e3', 'source:s2'))).toBe(false)
    expect(ids.has(eid('entitlement:e4', 'source:s1'))).toBe(false)
    expect(lineageNodeIds(scene.edges, 'role:role-a').has('role:role-a')).toBe(false)
  })

  it('walks a role with an access profile AND a direct entitlement', () => {
    const edges = [
      edge('user', 'role'),
      edge('role', 'ap'),
      edge('role', 'ent'),
      edge('ap', 'nested'),
      edge('nested', 'src'),
      edge('ent', 'src'),
    ]
    expect(sorted(lineageEdgeIds(edges, 'role'))).toEqual(
      sorted(edges.filter((e) => e.source !== 'user').map((e) => e.id)),
    )
  })

  it('dedupes a diamond / shared downstream edge', () => {
    const edges = [edge('item', 'a'), edge('item', 'b'), edge('a', 'shared'), edge('b', 'shared'), edge('shared', 'src')]
    const ids = lineageEdgeIds(edges, 'item')
    expect(ids.size).toBe(5)
    expect(ids.has(eid('shared', 'src'))).toBe(true)
  })

  it('terminates on a cycle', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]
    expect(sorted(lineageEdgeIds(edges, 'a'))).toEqual(sorted(edges.map((e) => e.id)))
    expect(sorted(lineageNodeIds(edges, 'a'))).toEqual(['b', 'c'])
  })

  it('is empty for an unknown id, a leaf, and a reference-hidden scene', () => {
    expect(lineageEdgeIds(scene.edges, 'nope').size).toBe(0)
    expect(lineageEdgeIds(scene.edges, 'source:s1').size).toBe(0)
    const hidden = buildAccessScene(withoutReference(sub()), 'LR', { singleLane: true })
    for (const e of hidden.edges) {
      expect(lineageEdgeIds(hidden.edges, e.target).size).toBe(0)
      expect(lineageNodeIds(hidden.edges, e.target).size).toBe(0)
    }
  })

  describe('an item held directly AND nested under a held role', () => {
    let both: Edge[]
    beforeAll(async () => {
      const graph: AccessGraphData = await buildFixtureGraph()
      both = buildAccessScene(userSubgraph(graph, 'user:u-a'), 'LR').edges
    })

    it('excludes upstream edges for the entitlement', () => {
      const ids = lineageEdgeIds(both, 'entitlement:e-read')
      expect([...ids].sort()).toEqual(
        [
          eid('entitlement:e-read', 'attribute:s-erp:memberOf'),
          eid('attribute:s-erp:memberOf', 'source:s-erp'),
        ].sort(),
      )
      expect(ids.has(eid('accessProfile:ap-foo', 'entitlement:e-read'))).toBe(false)
    })

    it('includes the nested path for the role', () => {
      const ids = lineageEdgeIds(both, 'role:role-a')
      expect(ids.has(eid('role:role-a', 'accessProfile:ap-foo'))).toBe(true)
      expect(ids.has(eid('accessProfile:ap-foo', 'entitlement:e-read'))).toBe(true)
      expect(ids.has(eid('entitlement:e-read', 'attribute:s-erp:memberOf'))).toBe(true)
      expect(ids.has(eid('attribute:s-erp:memberOf', 'source:s-erp'))).toBe(true)
      expect(ids.has(eid('role:role-a', 'entitlement:e-del'))).toBe(true)
      expect(ids.has(eid('user:u-a', 'entitlement:e-read'))).toBe(false)
    })
  })
})

describe('highlightEdges', () => {
  const scene = buildAccessScene(sub(), 'LR')
  const statusEdges = scene.edges.filter(isStatus)
  const incoming = (target: string) => statusEdges.find((e) => e.target === target)!

  it('returns emphasizeEdges output when nothing is selected', () => {
    expect(highlightEdges(scene.edges, null, null)).toBe(scene.edges)
    expect(highlightEdges(scene.edges, null, 'entitlement:e3')).toEqual(
      emphasizeEdges(scene.edges, 'entitlement:e3'),
    )
  })

  it('falls back to emphasizeEdges for the user, a reference node and an unknown id', () => {
    for (const id of ['user:u1', 'accessProfile:ap-foo', 'nope']) {
      expect(highlightEdges(scene.edges, id, null)).toBe(scene.edges)
      expect(highlightEdges(scene.edges, id, 'entitlement:e3')).toEqual(
        emphasizeEdges(scene.edges, 'entitlement:e3'),
      )
    }
  })

  it('raises the selected edge and the lineage in the status color, dims the rest', () => {
    const out = highlightEdges(scene.edges, 'role:role-a', null)
    const original = byId(scene.edges)
    const selected = out.find((e) => e.className?.includes(SELECTED_EDGE_CLASS))!
    expect(selected.id).toBe(incoming('role:role-a').id)
    expect(selected.zIndex).toBe(EMPHASIS_EDGE_Z_INDEX)
    expect(selected.zIndex).toBeGreaterThan(CARD_Z_INDEX)
    expect(selected.style?.strokeWidth).toBe(SELECTION_STROKE_WIDTH)
    expect(selected.style?.strokeDasharray).toBe(original.get(selected.id)!.style?.strokeDasharray)
    expect(selected.style?.stroke).toBe(original.get(selected.id)!.style?.stroke)
    expect(selected.interactionWidth).toBe(0)

    const lineage = out.filter((e) => e.className?.includes(LINEAGE_EDGE_CLASS))
    expect(sorted(lineage.map((e) => e.id))).toEqual(
      sorted(lineageEdgeIds(scene.edges, 'role:role-a')),
    )
    for (const e of lineage) {
      expect(e.zIndex).toBe(EMPHASIS_EDGE_Z_INDEX)
      expect(e.interactionWidth).toBe(0)
      expect(e.style).toMatchObject({
        stroke: STATUS_STROKE.needsReview,
        strokeWidth: LINEAGE_STROKE_WIDTH,
        strokeDasharray: 'none',
        opacity: 1,
      })
    }

    const highlighted = new Set([selected.id, ...lineage.map((e) => e.id)])
    expect(highlighted.size).toBe(1 + lineage.length)
    for (const e of out) {
      if (highlighted.has(e.id)) continue
      expect(e.style?.opacity).toBe(isStatus(e) ? DIM_STATUS_OPACITY : DIM_REFERENCE_OPACITY)
      expect(e.zIndex).toBe(original.get(e.id)!.zIndex)
    }
  })

  it('highlights a shared downstream edge once, and only for the selected item', () => {
    const forAdmin = highlightEdges(scene.edges, 'entitlement:e3', null)
    const forLogin = highlightEdges(scene.edges, 'accessProfile:ap-b', null)
    const lineageOf = (out: Edge[]) =>
      out.filter((e) => e.className?.includes(LINEAGE_EDGE_CLASS)).map((e) => e.id)
    expect(lineageOf(forAdmin)).toEqual([eid('entitlement:e3', 'source:s2')])
    expect(sorted(lineageOf(forLogin))).toEqual(
      sorted([eid('accessProfile:ap-b', 'entitlement:e2'), eid('entitlement:e2', 'source:s2')]),
    )
    expect(forAdmin.find((e) => e.id === eid('entitlement:e2', 'source:s2'))!.style?.opacity).toBe(
      DIM_REFERENCE_OPACITY,
    )
  })

  it.each([
    ['role:role-a', 'needsReview'],
    ['accessProfile:ap-b', 'approved'],
    ['entitlement:e3', 'revoked'],
    ['entitlement:e4', 'reassigned'],
  ] as [string, AccessReviewStatus][])(
    'colors the lineage of %s with the %s stroke the scene gave its user edge',
    (id, status) => {
      const sceneStroke = incoming(id).style?.stroke
      expect(STATUS_STROKE[status]).toBe(sceneStroke)
      const out = highlightEdges(scene.edges, id, null)
      const lineage = out.filter((e) => e.className?.includes(LINEAGE_EDGE_CLASS))
      expect(lineage.length).toBeGreaterThan(0)
      for (const e of lineage) expect(e.style?.stroke).toBe(sceneStroke)
    },
  )

  it('uses the aggregated status color for a mixed item', () => {
    const edges: Edge[] = [
      {
        id: eid('user', 'item'),
        source: 'user',
        target: 'item',
        className: 'vc-graph-edge-status vc-graph-edge-revoked',
        data: { reviewStatus: 'revoked', reviewMixed: true },
        style: { stroke: 'var(--vc-deny)', strokeWidth: 2 },
        zIndex: 1,
      },
      { ...edge('item', 'src'), data: { reference: true }, style: { opacity: 0.45 }, zIndex: 0 },
    ]
    const out = highlightEdges(edges, 'item', null)
    expect(out[1].style?.stroke).toBe(STATUS_STROKE.revoked)
  })

  it('previews a hovered DIFFERENT item while the selection stays highlighted', () => {
    const base = highlightEdges(scene.edges, 'role:role-a', null)
    const out = highlightEdges(scene.edges, 'role:role-a', 'entitlement:e3')
    const preview = incoming('entitlement:e3')
    const previewOut = out.find((e) => e.id === preview.id)!
    expect(previewOut.className).toContain('vc-graph-edge-emphasized')
    expect(previewOut.zIndex).toBe(EMPHASIS_EDGE_Z_INDEX)
    expect(previewOut.style?.opacity).toBeUndefined()
    // Everything except the previewed edge is exactly the plain selection.
    expect(out.filter((e) => e.id !== preview.id)).toEqual(base.filter((e) => e.id !== preview.id))
  })

  it('adds nothing when the hovered item is the selected one, a reference node or unknown', () => {
    const base = highlightEdges(scene.edges, 'role:role-a', null)
    expect(highlightEdges(scene.edges, 'role:role-a', 'role:role-a')).toEqual(base)
    expect(highlightEdges(scene.edges, 'role:role-a', 'accessProfile:ap-foo')).toEqual(base)
    expect(highlightEdges(scene.edges, 'role:role-a', 'nope')).toEqual(base)
  })

  it('with reference hidden highlights only the user -> item edge', () => {
    const hidden = buildAccessScene(withoutReference(sub()), 'LR', { singleLane: true })
    const out = highlightEdges(hidden.edges, 'role:role-a', null)
    expect(out.filter((e) => e.className?.includes(SELECTED_EDGE_CLASS))).toHaveLength(1)
    expect(out.filter((e) => e.className?.includes(LINEAGE_EDGE_CLASS))).toHaveLength(0)
    expect(out.filter((e) => e.style?.opacity === DIM_STATUS_OPACITY)).toHaveLength(
      hidden.edges.length - 1,
    )
  })

  it('does not mutate its input, is deterministic, and returns new edge objects', () => {
    const before = clone(scene.edges)
    const out = highlightEdges(scene.edges, 'role:role-a', 'entitlement:e3')
    expect(scene.edges).toEqual(before)
    expect(highlightEdges(scene.edges, 'role:role-a', 'entitlement:e3')).toEqual(out)
    out.forEach((e, i) => {
      expect(e).not.toBe(scene.edges[i])
      expect(e.style).not.toBe(scene.edges[i].style)
    })
  })

  it('returns to the baseline once the selection is cleared', () => {
    highlightEdges(scene.edges, 'role:role-a', null)
    expect(highlightEdges(scene.edges, null, null)).toEqual(clone(scene.edges))
  })
})

describe('reference-node selection', () => {
  // user → role → read → memberOf → ERP, plus an unrelated login → Directory.
  const edges: Edge[] = [
    {
      ...edge('user:u1', 'role:role-a'),
      data: { reviewStatus: 'needsReview' },
      style: { stroke: 'var(--vc-warn)', strokeWidth: 2, strokeDasharray: '6 4' },
    },
    {
      ...edge('role:role-a', 'entitlement:e-read'),
      className: 'vc-graph-edge-reference',
      data: { reference: true },
      style: { stroke: 'var(--edge)', strokeWidth: 1, opacity: 0.45 },
    },
    {
      ...edge('entitlement:e-read', 'attribute:s-erp:memberOf'),
      className: 'vc-graph-edge-reference',
      data: { reference: true },
      style: { stroke: 'var(--edge)', strokeWidth: 1, opacity: 0.45 },
    },
    {
      ...edge('attribute:s-erp:memberOf', 'source:s-erp'),
      className: 'vc-graph-edge-reference',
      data: { reference: true },
      style: { stroke: 'var(--edge)', strokeWidth: 1, opacity: 0.45 },
    },
    {
      ...edge('user:u1', 'entitlement:e-login'),
      data: { reviewStatus: 'approved' },
      style: { stroke: 'var(--vc-allow)', strokeWidth: 2 },
    },
    {
      ...edge('entitlement:e-login', 'source:s-dir'),
      className: 'vc-graph-edge-reference',
      data: { reference: true },
      style: { stroke: 'var(--edge)', strokeWidth: 1, opacity: 0.45 },
    },
  ]
  const reference = { reference: true } as const

  it('highlights the path through an attribute in both directions and dims the rest', () => {
    const id = 'attribute:s-erp:memberOf'
    expect(sorted(connectedEdgeIds(edges, id))).toEqual(
      sorted([
        eid('user:u1', 'role:role-a'),
        eid('role:role-a', 'entitlement:e-read'),
        eid('entitlement:e-read', 'attribute:s-erp:memberOf'),
        eid('attribute:s-erp:memberOf', 'source:s-erp'),
      ]),
    )
    expect(connectedNodeIds(edges, id).has('source:s-erp')).toBe(true)
    expect(connectedNodeIds(edges, id).has('entitlement:e-read')).toBe(true)
    expect(connectedNodeIds(edges, id).has(id)).toBe(false)
    expect(connectedEdgeIds(edges, id).has(eid('entitlement:e-login', 'source:s-dir'))).toBe(false)

    const out = highlightEdges(edges, id, null, reference)
    const highlighted = out.filter((e) => e.className?.includes(LINEAGE_EDGE_CLASS))
    expect(sorted(highlighted.map((e) => e.id))).toEqual(sorted(connectedEdgeIds(edges, id)))
    const status = out.find((e) => e.id === eid('user:u1', 'role:role-a'))!
    expect(status.style?.stroke).toBe('var(--vc-warn)')
    expect(status.style?.strokeDasharray).toBe('6 4')
    const link = out.find((e) => e.id === eid('entitlement:e-read', 'attribute:s-erp:memberOf'))!
    expect(link.style?.stroke).toBe('var(--edge)')
    expect(link.style?.opacity).toBe(1)
    expect(link.style?.strokeWidth).toBe(LINEAGE_STROKE_WIDTH)
    const unrelated = out.find((e) => e.id === eid('entitlement:e-login', 'source:s-dir'))!
    expect(unrelated.style?.opacity).toBe(DIM_REFERENCE_OPACITY)
  })

  it('highlights the incoming links of a source, which has nothing downstream', () => {
    const out = highlightEdges(edges, 'source:s-erp', null, reference)
    expect(sorted(out.filter((e) => e.className?.includes(LINEAGE_EDGE_CLASS)).map((e) => e.id))).toEqual(
      sorted(connectedEdgeIds(edges, 'source:s-erp')),
    )
    expect(connectedEdgeIds(edges, 'source:s-erp').has(eid('attribute:s-erp:memberOf', 'source:s-erp'))).toBe(
      true,
    )
    expect(connectedEdgeIds(edges, 'source:s-erp').has(eid('user:u1', 'entitlement:e-login'))).toBe(
      false,
    )
  })
})
