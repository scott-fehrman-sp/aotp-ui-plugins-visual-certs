import { describe, expect, it } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import { NODE_WIDTH } from './buildAccessScene'
import { buildUserGridScene } from './buildUserGridScene'

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
})
