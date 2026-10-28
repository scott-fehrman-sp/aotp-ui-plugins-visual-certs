import { describe, expect, it } from 'vitest'
import type { AccessCompositionResolver } from '../sailpoint/accessMatrix'
import { resolveMatrix } from '../sailpoint/accessMatrix'
import type { AccessGraphData, ReviewItemVM } from '../sailpoint/types'
import {
  buildFixtureGraph,
  fixtureItems,
  fixtureResolver,
  reviewItem,
} from '../test/reviewStatusFixture'
import { deriveAccessGraph } from './accessGraph'
import { applyReviewStatus, buildReviewIndex, copyFirstLevelStatus, reviewKey } from './reviewOverlay'

const edgeOf = (graph: AccessGraphData, from: string, to: string) =>
  graph.edges.find((e) => e.from === from && e.to === to)

/** All permutations of a small array (used for order-independence checks). */
function permutations<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list]
  return list.flatMap((head, i) =>
    permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [
      head,
      ...rest,
    ]),
  )
}

describe('reviewOverlay', () => {
  it("matches by the review item's own accessId even when the resolved composition id differs", async () => {
    // The review item asks for role 'role-requested'; the API body reports a
    // different canonical id. The graph node uses the resolved id, but the
    // overlay must still match on the review item's OWN accessId.
    const resolver: AccessCompositionResolver = {
      ...fixtureResolver(),
      role: () =>
        Promise.resolve({
          id: 'role-canonical',
          name: 'Role Canon',
          description: '',
          accessProfileRefs: [],
          entitlementRefs: [{ id: 'e-pay', name: 'Pay' }],
          owner: '',
          enabled: false,
          requestable: false,
          privilegeLevel: '',
          dimensional: false,
          created: '',
          modified: '',
        }),
    }
    const items = [
      reviewItem({
        id: 'x',
        accessKind: 'role',
        accessId: 'role-requested',
        accessName: 'Role Canon',
        completed: true,
        decision: 'REVOKE',
      }),
    ]
    const rows = await resolveMatrix(items, resolver)
    const graph = applyReviewStatus(deriveAccessGraph(rows), items)

    const edge = edgeOf(graph, 'user:u-a', 'role:role-canonical')
    expect(edge?.firstLevel).toBe(true)
    expect(edge?.reviewKey).toBe(
      reviewKey('u-a', 'role', 'role-requested', 'Role Canon'),
    )
    expect(edge?.reviewStatus).toBe('revoked')
  })

  it('falls back to the access name when accessId is null', async () => {
    const items = [
      reviewItem({
        id: 'x',
        accessKind: 'entitlement',
        accessId: null,
        accessName: 'Orphan',
        completed: true,
        decision: 'APPROVE',
      }),
    ]
    const rows = await resolveMatrix(items, fixtureResolver())
    const graph = applyReviewStatus(deriveAccessGraph(rows), items)

    const edge = graph.edges.find((e) => e.from === 'user:u-a')
    expect(edge?.firstLevel).toBe(true)
    expect(edge?.reviewKey).toBe(reviewKey('u-a', 'entitlement', null, 'Orphan'))
    expect(edge?.reviewStatus).toBe('approved')
  })

  it('aggregates several review items for one user+item deterministically (needsReview > reassigned > revoked > approved), independent of order', async () => {
    const make = (id: string, over: Partial<ReviewItemVM>) =>
      reviewItem({
        id,
        accessKind: 'accessProfile',
        accessId: 'ap-bill',
        accessName: 'Billing',
        ...over,
      })
    const approved = make('1', { completed: true, decision: 'APPROVE' })
    const revoked = make('2', { completed: true, decision: 'REVOKE' })
    const reassigned = make('3', { reassigned: true })
    const needsReview = make('4', {})
    const key = reviewKey('u-a', 'accessProfile', 'ap-bill', 'Billing')

    for (const order of permutations([approved, revoked, reassigned, needsReview])) {
      expect(buildReviewIndex(order).get(key)?.status).toBe('needsReview')
      const graph = await buildFixtureGraph(order)
      expect(edgeOf(graph, 'user:u-a', 'accessProfile:ap-bill')?.reviewStatus).toBe(
        'needsReview',
      )
    }
    for (const order of permutations([approved, revoked, reassigned])) {
      expect(buildReviewIndex(order).get(key)?.status).toBe('reassigned')
    }
    for (const order of permutations([approved, revoked])) {
      expect(buildReviewIndex(order).get(key)?.status).toBe('revoked')
    }
  })

  it('flags mixed statuses', () => {
    const make = (id: string, over: Partial<ReviewItemVM>) =>
      reviewItem({
        id,
        accessKind: 'accessProfile',
        accessId: 'ap-bill',
        accessName: 'Billing',
        ...over,
      })
    const key = reviewKey('u-a', 'accessProfile', 'ap-bill', 'Billing')

    const mixed = buildReviewIndex([
      make('1', { completed: true, decision: 'APPROVE' }),
      make('2', {}),
    ])
    expect(mixed.get(key)).toEqual({ status: 'needsReview', mixed: true })

    const uniform = buildReviewIndex([
      make('1', { completed: true, decision: 'APPROVE' }),
      make('2', { completed: true, decision: 'APPROVE' }),
    ])
    expect(uniform.get(key)).toEqual({ status: 'approved', mixed: false })
  })

  it("skips 'access'-kind items and keeps users apart", () => {
    const index = buildReviewIndex([
      reviewItem({ id: 'g', accessKind: 'access', accessId: null }),
      ...fixtureItems(),
    ])
    expect(index.has(reviewKey('u-a', 'access' as never, null, 'access'))).toBe(false)
    expect(index.get(reviewKey('u-a', 'entitlement', 'e-login', 'Login'))?.status).toBe(
      'approved',
    )
    expect(index.get(reviewKey('u-b', 'entitlement', 'e-login', 'Login'))?.status).toBe(
      'needsReview',
    )
  })

  it('applyReviewStatus does not mutate its input and reuses the nodes array', async () => {
    const items = fixtureItems()
    const rows = await resolveMatrix(items, fixtureResolver())
    const structural = deriveAccessGraph(rows)
    const snapshot = JSON.stringify(structural)
    const applied = applyReviewStatus(structural, items)
    expect(JSON.stringify(structural)).toBe(snapshot)
    expect(applied.nodes).toBe(structural.nodes)
    expect(applied.edges).not.toBe(structural.edges)
  })

  it('copyFirstLevelStatus copies status by reviewKey and leaves other edges alone', () => {
    const target: AccessGraphData = {
      nodes: [],
      edges: [
        {
          from: 'user:u1',
          to: 'role:role-a',
          pathCount: 1,
          firstLevel: true,
          reviewKey: 'u1|role|role-a',
        },
        { from: 'role:role-a', to: 'entitlement:e1', pathCount: 1 },
      ],
    }
    const source: AccessGraphData = {
      nodes: [],
      edges: [
        {
          from: 'user:u1',
          to: 'role:role-a',
          pathCount: 1,
          firstLevel: true,
          reviewKey: 'u1|role|role-a',
          reviewStatus: 'approved',
          reviewMixed: false,
        },
      ],
    }
    const copied = copyFirstLevelStatus(target, source)
    expect(copied.nodes).toBe(target.nodes)
    expect(copied.edges[0].reviewStatus).toBe('approved')
    expect(copied.edges[1].reviewStatus).toBeUndefined()
    // The structural target is not mutated.
    expect(target.edges[0].reviewStatus).toBeUndefined()
  })
})
