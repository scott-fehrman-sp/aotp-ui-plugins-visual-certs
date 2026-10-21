import { describe, expect, it } from 'vitest'
import type { Edge } from '@xyflow/react'
import { statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { userSubgraph } from './userSubgraph'
import { withoutReference } from './referenceFilter'
import { CARD_Z_INDEX, buildAccessScene } from './buildAccessScene'
import {
  DIM_REFERENCE_OPACITY,
  DIM_STATUS_OPACITY,
  EMPHASIS_EDGE_Z_INDEX,
  EMPHASIS_STROKE_WIDTH,
  emphasizeEdges,
} from './emphasizeEdges'

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
 * role-a{ap-foo{e1}} needsReview, ap-b{e2} approved, e3 revoked (direct),
 * e4 reassigned (direct): one first-level item of every kind and status, with
 * nested lineage so reference edges exist.
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
const isReference = (e: Edge) => Boolean((e.data as { reference?: boolean } | undefined)?.reference)
const clone = <T,>(value: T): T => structuredClone(value)

describe('emphasizeEdges', () => {
  const scene = buildAccessScene(sub(), 'LR')
  const firstLevel = scene.edges.filter(isStatus)

  it('has a status edge per first-level item and some reference edges', () => {
    expect(firstLevel).toHaveLength(4)
    expect(scene.edges.some(isReference)).toBe(true)
  })

  it('returns the same array for null, the user, a reference node and an unknown id', () => {
    expect(emphasizeEdges(scene.edges, null)).toBe(scene.edges)
    expect(emphasizeEdges(scene.edges, 'user:u1')).toBe(scene.edges)
    const referenceTarget = scene.edges.find(isReference)!.target
    expect(emphasizeEdges(scene.edges, referenceTarget)).toBe(scene.edges)
    expect(emphasizeEdges(scene.edges, 'nope')).toBe(scene.edges)
  })

  it('raises only the focused incoming status edge above the cards and thickens it', () => {
    const target = firstLevel[0].target
    const out = emphasizeEdges(scene.edges, target)
    const raised = out.filter((e) => (e.zIndex ?? 0) > CARD_Z_INDEX)
    expect(raised).toHaveLength(1)
    const edge = raised[0]
    expect(edge.target).toBe(target)
    expect(edge.zIndex).toBe(EMPHASIS_EDGE_Z_INDEX)
    expect(EMPHASIS_EDGE_Z_INDEX).toBeGreaterThan(CARD_Z_INDEX)
    const original = scene.edges.find((e) => e.id === edge.id)!
    expect(edge.style?.strokeWidth).toBe(EMPHASIS_STROKE_WIDTH)
    expect(EMPHASIS_STROKE_WIDTH).toBeGreaterThan(Number(original.style?.strokeWidth))
    expect(edge.interactionWidth).toBe(0)
    expect(edge.className).toBe(`${original.className} vc-graph-edge-emphasized`)
    expect(edge.style?.stroke).toBe(original.style?.stroke)
    expect(edge.style?.strokeDasharray).toBe(original.style?.strokeDasharray)
    expect(edge.style?.opacity).toBeUndefined()
  })

  it('dims every other status edge and every reference edge, keeping stroke and dash', () => {
    const target = firstLevel[1].target
    const out = emphasizeEdges(scene.edges, target)
    out.forEach((edge, i) => {
      if (edge.target === target && isStatus(edge)) return
      const original = scene.edges[i]
      expect(edge.style?.opacity).toBe(
        isStatus(edge) ? DIM_STATUS_OPACITY : DIM_REFERENCE_OPACITY,
      )
      expect(edge.style?.stroke).toBe(original.style?.stroke)
      expect(edge.style?.strokeDasharray).toBe(original.style?.strokeDasharray)
      expect(edge.zIndex).toBe(original.zIndex)
      expect(edge.className).toBe(original.className)
    })
  })

  it('does not mutate its input and returns new edge objects', () => {
    const before = clone(scene.edges)
    const refs = [...scene.edges]
    const out = emphasizeEdges(scene.edges, firstLevel[2].target)
    expect(scene.edges).toEqual(before)
    expect(scene.edges).toEqual(refs)
    out.forEach((edge, i) => {
      expect(edge).not.toBe(scene.edges[i])
      expect(edge.style).not.toBe(scene.edges[i].style)
    })
  })

  it('is deterministic', () => {
    const target = firstLevel[3].target
    expect(emphasizeEdges(scene.edges, target)).toEqual(emphasizeEdges(scene.edges, target))
  })

  it.each(['LR', 'TB'] as const)('works for each first-level kind in %s', (rankdir) => {
    const s = buildAccessScene(sub(), rankdir)
    const status = s.edges.filter(isStatus)
    const kinds = new Set(
      status.map((e) => s.nodes.find((n) => n.id === e.target)!.data.kind),
    )
    expect(kinds).toEqual(new Set(['role', 'accessProfile', 'entitlement']))
    for (const edge of status) {
      const out = emphasizeEdges(s.edges, edge.target)
      const emphasized = out.filter((e) => e.className?.includes('vc-graph-edge-emphasized'))
      expect(emphasized.map((e) => e.id)).toEqual([edge.id])
      expect(emphasized[0].sourceHandle).toBe(edge.sourceHandle)
      expect(emphasized[0].targetHandle).toBe(edge.targetHandle)
    }
  })

  it('works on a scene with no reference edges', () => {
    const s = buildAccessScene(withoutReference(sub()), 'LR', { singleLane: true })
    expect(s.edges.some(isReference)).toBe(false)
    const target = s.edges[0].target
    const out = emphasizeEdges(s.edges, target)
    expect(out.filter((e) => e.zIndex === EMPHASIS_EDGE_Z_INDEX)).toHaveLength(1)
    expect(out.filter((e) => e.style?.opacity === DIM_STATUS_OPACITY)).toHaveLength(
      s.edges.length - 1,
    )
  })

  it('returns to baseline once the emphasis is cleared', () => {
    const target = firstLevel[0].target
    emphasizeEdges(scene.edges, target)
    expect(emphasizeEdges(scene.edges, null)).toEqual(clone(scene.edges))
  })
})
