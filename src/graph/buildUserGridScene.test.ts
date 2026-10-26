import { describe, expect, it } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import { statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { NODE_WIDTH } from './buildAccessScene'
import { buildUserGridScene } from './buildUserGridScene'

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

/** A multi-kind graph: one user with a full 5-layer path. */
function multiKind(): AccessMatrixRowVM[] {
  return [
    row({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
  ]
}

/** `count` distinct users (each a direct entitlement row). */
function nUsers(count: number): AccessMatrixRowVM[] {
  return Array.from({ length: count }, (_, i) =>
    row({
      id: `r${i}`,
      userId: `u${i}`,
      user: `User ${i}`,
      entitlement: 'read',
      entitlementId: `e${i}`,
      source: 'app',
      sourceId: 's0',
    }),
  )
}

describe('buildUserGridScene', () => {
  it('includes only user-kind nodes and filters out non-user nodes', () => {
    const graph = deriveAccessGraph(multiKind())
    const scene = buildUserGridScene(graph, 1200)

    expect(scene.nodes).toHaveLength(1)
    expect(scene.nodes[0]?.id).toBe('user:u1')
    expect(scene.nodes.every((n) => n.data.kind === 'user')).toBe(true)
  })

  it('drops all edges', () => {
    const graph = deriveAccessGraph(multiKind())
    const scene = buildUserGridScene(graph, 1200)
    expect(scene.edges).toEqual([])
  })

  it('marks every card interactive and produces finite positions', () => {
    const graph = deriveAccessGraph(nUsers(5))
    const scene = buildUserGridScene(graph, 1200)
    for (const node of scene.nodes) {
      expect(node.data.interactive).toBe(true)
      expect(Number.isFinite(node.position.x)).toBe(true)
      expect(Number.isFinite(node.position.y)).toBe(true)
    }
  })

  it('wires onSelect per node id when a factory is supplied', () => {
    const graph = deriveAccessGraph(nUsers(2))
    const selected: string[] = []
    const scene = buildUserGridScene(graph, 1200, (id) => selected.push(id))
    scene.nodes.forEach((n) => n.data.onSelect?.())
    expect(selected).toEqual(['user:u0', 'user:u1'])
  })

  it('lays users out in the column count computed from the viewport width', () => {
    const graph = deriveAccessGraph(nUsers(10))
    const viewportWidth = 1200
    const expectedColumns = Math.max(
      1,
      Math.min(10, Math.floor((Math.max(viewportWidth, 720) - 96) / (NODE_WIDTH + 36))),
    )
    const scene = buildUserGridScene(graph, viewportWidth)
    const distinctX = new Set(scene.nodes.map((n) => n.position.x))
    expect(distinctX.size).toBe(expectedColumns)
  })

  it('orders user cards by the resolved last name, not insertion order', () => {
    // Insertion order is Zuel, Adams, Brown; last-name order is Adams, Brown,
    // Zuel. The grid fills row-major, so reading by (row y, then column x)
    // recovers the card order.
    const graph = deriveAccessGraph([
      row({ id: '1', userId: 'u-z', userFirstName: 'Carol', userLastName: 'Zuel', entitlement: 'read', entitlementId: 'e1', source: 'app', sourceId: 's0' }),
      row({ id: '2', userId: 'u-a', userFirstName: 'Bob', userLastName: 'Adams', entitlement: 'read', entitlementId: 'e2', source: 'app', sourceId: 's0' }),
      row({ id: '3', userId: 'u-b', userFirstName: 'Alice', userLastName: 'Brown', entitlement: 'read', entitlementId: 'e3', source: 'app', sourceId: 's0' }),
    ])
    const scene = buildUserGridScene(graph, 1200)
    const order = [...scene.nodes]
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((n) => n.id)
    expect(order).toEqual(['user:u-a', 'user:u-b', 'user:u-z'])
  })

  it('sorts on the real last name, not the last token of the display label', () => {
    // Display label would mis-sort these ("First Vang" vs "First Oakes" by last
    // token), but the resolved last names (Abe, Zent) are authoritative.
    const graph = deriveAccessGraph([
      row({ id: '1', userId: 'u-zent', user: 'Oakes, Lee', userFirstName: 'Lee', userLastName: 'Zent', entitlement: 'read', entitlementId: 'e1', source: 'app', sourceId: 's0' }),
      row({ id: '2', userId: 'u-abe', user: 'Vang, Kim', userFirstName: 'Kim', userLastName: 'Abe', entitlement: 'read', entitlementId: 'e2', source: 'app', sourceId: 's0' }),
    ])
    const scene = buildUserGridScene(graph, 1200)
    const order = [...scene.nodes]
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((n) => n.id)
    expect(order).toEqual(['user:u-abe', 'user:u-zent'])
  })

  it('tie-breaks equal last names by full label then id', () => {
    // Two "Smith"s: "Ann Smith" sorts before "Zed Smith" on the full label.
    const graph = deriveAccessGraph([
      row({ id: '1', userId: 'u-zed', userFirstName: 'Zed', userLastName: 'Smith', entitlement: 'read', entitlementId: 'e1', source: 'app', sourceId: 's0' }),
      row({ id: '2', userId: 'u-ann', userFirstName: 'Ann', userLastName: 'Smith', entitlement: 'read', entitlementId: 'e2', source: 'app', sourceId: 's0' }),
    ])
    const scene = buildUserGridScene(graph, 1200)
    const order = [...scene.nodes]
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((n) => n.id)
    expect(order).toEqual(['user:u-ann', 'user:u-zed'])
  })

  it('falls back to the display label last token when no last name is resolved', () => {
    // Soft-degraded identities: no first/last name, so the label (= display
    // name) and its last token are all we have to sort on.
    const graph = deriveAccessGraph([
      row({ id: '1', userId: 'u-z', user: 'Carol Zuel', entitlement: 'read', entitlementId: 'e1', source: 'app', sourceId: 's0' }),
      row({ id: '2', userId: 'u-a', user: 'Bob Adams', entitlement: 'read', entitlementId: 'e2', source: 'app', sourceId: 's0' }),
    ])
    const scene = buildUserGridScene(graph, 1200)
    const order = [...scene.nodes]
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((n) => n.id)
    expect(order).toEqual(['user:u-a', 'user:u-z'])
  })

  it('returns an empty scene when there are no user nodes', () => {
    const scene = buildUserGridScene({ nodes: [], edges: [] }, 1200)
    expect(scene.nodes).toEqual([])
    expect(scene.edges).toEqual([])
  })

  it('threads the user node detail (department/location) onto the card data', () => {
    const graph = deriveAccessGraph([
      row({
        id: '1',
        userDepartment: 'Engineering',
        userLocation: 'Austin',
        entitlement: 'read',
        entitlementId: 'e1',
        source: 'app',
        sourceId: 's0',
      }),
    ])
    const scene = buildUserGridScene(graph, 1200)
    expect(scene.nodes[0]?.data.detail).toEqual({
      department: 'Engineering',
      location: 'Austin',
    })
  })

  it('stamps each user card with that user\'s completed-access percentage', () => {
    const graph = statusGraph([
      row({ id: '1', userId: 'u1', user: 'Ann Smith', entitlement: 'a', entitlementId: 'e1', source: 'app', sourceId: 's0', reviewStatus: 'approved', accessItemKind: 'entitlement', accessItemId: 'e1', accessItemName: 'a' }),
      row({ id: '2', userId: 'u1', user: 'Ann Smith', entitlement: 'b', entitlementId: 'e2', source: 'app', sourceId: 's0', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: 'e2', accessItemName: 'b' }),
      row({ id: '3', userId: 'u2', user: 'Bea Jones', entitlement: 'c', entitlementId: 'e3', source: 'app', sourceId: 's0', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e3', accessItemName: 'c' }),
    ])
    const scene = buildUserGridScene(graph, 1200)
    const byId = new Map(scene.nodes.map((n) => [n.id, n.data.completion]))
    expect(byId.get('user:u1')).toEqual({ percent: 50, completed: 1, total: 2 })
    expect(byId.get('user:u2')).toEqual({ percent: 100, completed: 1, total: 1 })
  })
})
