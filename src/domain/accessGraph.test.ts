import { describe, expect, it } from 'vitest'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import { deriveAccessGraph } from './accessGraph'

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

/**
 * The 6-row worked example with ids, so node identity is exercised. Two `read`
 * entitlements on different sources (engr db vs accounting db vs phone app) are
 * distinct ids and must stay distinct nodes.
 */
function workedExample(): AccessMatrixRowVM[] {
  return [
    row({
      id: '1',
      role: 'Role A',
      roleId: 'role-a',
      accessProfile: 'foo',
      accessProfileId: 'ap-foo',
      entitlement: 'read',
      entitlementId: 'ent-read-engr',
      source: 'engr db',
      sourceId: 'src-engr',
    }),
    row({
      id: '2',
      role: 'Role A',
      roleId: 'role-a',
      accessProfile: 'foo',
      accessProfileId: 'ap-foo',
      entitlement: 'write',
      entitlementId: 'ent-write-engr',
      source: 'engr db',
      sourceId: 'src-engr',
    }),
    row({
      id: '3',
      role: 'Role A',
      roleId: 'role-a',
      accessProfile: '',
      accessProfileId: null,
      entitlement: 'delete',
      entitlementId: 'ent-delete-engr',
      source: 'engr db',
      sourceId: 'src-engr',
    }),
    row({
      id: '4',
      role: '',
      roleId: null,
      accessProfile: 'bar',
      accessProfileId: 'ap-bar',
      entitlement: 'read',
      entitlementId: 'ent-read-acct',
      source: 'accounting db',
      sourceId: 'src-acct',
    }),
    row({
      id: '5',
      role: '',
      roleId: null,
      accessProfile: 'bar',
      accessProfileId: 'ap-bar',
      entitlement: 'search',
      entitlementId: 'ent-search-acct',
      source: 'accounting db',
      sourceId: 'src-acct',
    }),
    row({
      id: '6',
      role: '',
      roleId: null,
      accessProfile: '',
      accessProfileId: null,
      entitlement: 'read',
      entitlementId: 'ent-read-phone',
      source: 'phone app',
      sourceId: 'src-phone',
    }),
  ]
}

describe('deriveAccessGraph', () => {
  it('empty input yields an empty graph', () => {
    expect(deriveAccessGraph([])).toEqual({ nodes: [], edges: [] })
  })

  it('does not mutate the input rows', () => {
    const rows = workedExample()
    const snapshot = JSON.stringify(rows)
    deriveAccessGraph(rows)
    expect(JSON.stringify(rows)).toBe(snapshot)
  })

  it('derives the expected node set for the 6-row worked example', () => {
    const { nodes } = deriveAccessGraph(workedExample())
    const ids = new Set(nodes.map((n) => n.id))

    // 1 user (deduped).
    expect(nodes.filter((n) => n.kind === 'user')).toHaveLength(1)
    expect(ids.has('user:u1')).toBe(true)

    // 1 role.
    expect(nodes.filter((n) => n.kind === 'role')).toHaveLength(1)
    expect(ids.has('role:role-a')).toBe(true)

    // 2 access profiles.
    expect(nodes.filter((n) => n.kind === 'accessProfile')).toHaveLength(2)
    expect(ids.has('accessProfile:ap-foo')).toBe(true)
    expect(ids.has('accessProfile:ap-bar')).toBe(true)

    // 6 distinct leaf entitlements (same-name-different-source stay distinct).
    expect(nodes.filter((n) => n.kind === 'entitlement')).toHaveLength(6)
    expect(ids.has('entitlement:ent-read-engr')).toBe(true)
    expect(ids.has('entitlement:ent-read-acct')).toBe(true)
    expect(ids.has('entitlement:ent-read-phone')).toBe(true)

    // 3 sources (engr db shared by three entitlements collapses to one node).
    expect(nodes.filter((n) => n.kind === 'source')).toHaveLength(3)
    expect(ids.has('source:src-engr')).toBe(true)
    expect(ids.has('source:src-acct')).toBe(true)
    expect(ids.has('source:src-phone')).toBe(true)
  })

  it('skips blank levels so the chain connects consecutive present levels', () => {
    const { edges } = deriveAccessGraph(workedExample())
    const has = (from: string, to: string): boolean =>
      edges.some((e) => e.from === from && e.to === to)

    // Role-direct `delete` row: user → role → entitlement → source (NO AP hop).
    expect(has('user:u1', 'role:role-a')).toBe(true)
    expect(has('role:role-a', 'entitlement:ent-delete-engr')).toBe(true)
    expect(has('entitlement:ent-delete-engr', 'source:src-engr')).toBe(true)

    // Direct `read@phone` row: user → entitlement → source (NO role/AP hop).
    expect(has('user:u1', 'entitlement:ent-read-phone')).toBe(true)
    expect(has('entitlement:ent-read-phone', 'source:src-phone')).toBe(true)

    // Role → AP → entitlement → source for foo/read.
    expect(has('role:role-a', 'accessProfile:ap-foo')).toBe(true)
    expect(has('accessProfile:ap-foo', 'entitlement:ent-read-engr')).toBe(true)

    // AP grant (no role): user → AP → entitlement → source for bar/read.
    expect(has('user:u1', 'accessProfile:ap-bar')).toBe(true)
    expect(has('accessProfile:ap-bar', 'entitlement:ent-read-acct')).toBe(true)
  })

  it('accumulates pathCount on shared edges', () => {
    const { edges } = deriveAccessGraph(workedExample())
    // engr db source is fed by three entitlements (read, write, delete).
    const toEngr = edges.filter((e) => e.to === 'source:src-engr')
    expect(toEngr).toHaveLength(3)
    expect(toEngr.every((e) => e.pathCount === 1)).toBe(true)

    // role → AP foo is traversed by BOTH foo/read and foo/write.
    const roleToFoo = edges.find(
      (e) => e.from === 'role:role-a' && e.to === 'accessProfile:ap-foo',
    )
    expect(roleToFoo?.pathCount).toBe(2)
  })

  it('keeps same-named entitlements on different sources distinct even without ids', () => {
    const rows = [
      row({
        id: 'a',
        entitlement: 'read',
        entitlementId: null,
        source: 'engr db',
        sourceId: 'src-engr',
      }),
      row({
        id: 'b',
        entitlement: 'read',
        entitlementId: null,
        source: 'accounting db',
        sourceId: 'src-acct',
      }),
    ]
    const { nodes } = deriveAccessGraph(rows)
    expect(nodes.filter((n) => n.kind === 'entitlement')).toHaveLength(2)
  })

  it('contributes only the known levels for an unresolved row', () => {
    // Fetch-failure unresolved row: role known, AP/entitlement blank, source
    // blank. It contributes the user and role nodes and the user→role edge only.
    const rows = [
      row({
        id: 'x',
        role: 'Role A',
        roleId: 'role-a',
        entitlement: '',
        entitlementId: null,
        source: '',
        sourceId: null,
        unresolved: true,
      }),
    ]
    const { nodes, edges } = deriveAccessGraph(rows)
    expect(nodes.map((n) => n.id).sort()).toEqual(
      ['role:role-a', 'user:u1'].sort(),
    )
    expect(edges).toEqual([
      { from: 'user:u1', to: 'role:role-a', pathCount: 1 },
    ])
  })

  it('puts department/location on the user node and description on each other kind, without changing node count', () => {
    // Enrich the worked example with user attributes + per-kind descriptions.
    const enriched = workedExample().map((r, i) => ({
      ...r,
      userDepartment: 'Engineering',
      userLocation: 'Austin',
      roleDescription: r.role ? 'Role A description' : undefined,
      accessProfileDescription: r.accessProfile
        ? `AP ${r.accessProfile} description`
        : undefined,
      entitlementDescription: `entitlement ${i} description`,
      sourceDescription: `source for ${r.source}`,
    }))
    const plain = deriveAccessGraph(workedExample())
    const { nodes } = deriveAccessGraph(enriched)

    // Dedup unaffected: same node count as the un-enriched graph.
    expect(nodes).toHaveLength(plain.nodes.length)

    const byId = new Map(nodes.map((n) => [n.id, n]))
    // User node carries department + location, no description.
    expect(byId.get('user:u1')?.detail).toEqual({
      department: 'Engineering',
      location: 'Austin',
    })
    // Role / AP / entitlement / source nodes carry a description only.
    expect(byId.get('role:role-a')?.detail).toEqual({
      description: 'Role A description',
    })
    expect(byId.get('accessProfile:ap-foo')?.detail).toEqual({
      description: 'AP foo description',
    })
    expect(byId.get('entitlement:ent-read-engr')?.detail?.description).toBeTruthy()
    expect(byId.get('source:src-engr')?.detail?.description).toBeTruthy()
  })

  it('omits detail entirely for a node with no extra data', () => {
    const { nodes } = deriveAccessGraph([
      row({ id: '1', entitlement: 'read', entitlementId: 'e1', source: 'app', sourceId: 's0' }),
    ])
    for (const node of nodes) {
      expect(node.detail).toBeUndefined()
    }
  })

  it('stamps reviewStatus on the user access-item node + user→item edge only', () => {
    // A role item that needs review: the role node and the user→role edge carry
    // needsReview; the AP / entitlement / source nodes and every deeper edge
    // carry no reviewStatus.
    const { nodes, edges } = deriveAccessGraph([
      row({
        id: '1',
        role: 'Role A',
        roleId: 'role-a',
        accessProfile: 'foo',
        accessProfileId: 'ap-foo',
        entitlement: 'read',
        entitlementId: 'ent-read-engr',
        source: 'engr db',
        sourceId: 'src-engr',
        reviewStatus: 'needsReview',
        accessItemKind: 'role',
        accessItemId: 'role-a',
      }),
    ])
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    expect(nodeById.get('role:role-a')?.reviewStatus).toBe('needsReview')
    expect(nodeById.get('user:u1')?.reviewStatus).toBeUndefined()
    expect(nodeById.get('accessProfile:ap-foo')?.reviewStatus).toBeUndefined()
    expect(nodeById.get('entitlement:ent-read-engr')?.reviewStatus).toBeUndefined()
    expect(nodeById.get('source:src-engr')?.reviewStatus).toBeUndefined()

    const edgeStatus = (from: string, to: string) =>
      edges.find((e) => e.from === from && e.to === to)?.reviewStatus
    expect(edgeStatus('user:u1', 'role:role-a')).toBe('needsReview')
    expect(edgeStatus('role:role-a', 'accessProfile:ap-foo')).toBeUndefined()
    expect(edgeStatus('accessProfile:ap-foo', 'entitlement:ent-read-engr')).toBeUndefined()
    expect(edgeStatus('entitlement:ent-read-engr', 'source:src-engr')).toBeUndefined()
  })

  it('marks an approved directly-held entitlement item on the user→entitlement node + edge', () => {
    const { nodes, edges } = deriveAccessGraph([
      row({
        id: '1',
        entitlement: 'read',
        entitlementId: 'ent-read-phone',
        source: 'phone app',
        sourceId: 'src-phone',
        reviewStatus: 'approved',
        accessItemKind: 'entitlement',
        accessItemId: 'ent-read-phone',
      }),
    ])
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    expect(nodeById.get('entitlement:ent-read-phone')?.reviewStatus).toBe('approved')
    expect(nodeById.get('source:src-phone')?.reviewStatus).toBeUndefined()
    const userToEnt = edges.find(
      (e) => e.from === 'user:u1' && e.to === 'entitlement:ent-read-phone',
    )
    expect(userToEnt?.reviewStatus).toBe('approved')
    const entToSource = edges.find(
      (e) => e.from === 'entitlement:ent-read-phone' && e.to === 'source:src-phone',
    )
    expect(entToSource?.reviewStatus).toBeUndefined()
  })

  it('marks a revoked directly-held entitlement item on the user→entitlement node + edge', () => {
    const { nodes, edges } = deriveAccessGraph([
      row({
        id: '1',
        entitlement: 'read',
        entitlementId: 'ent-read-phone',
        source: 'phone app',
        sourceId: 'src-phone',
        reviewStatus: 'revoked',
        accessItemKind: 'entitlement',
        accessItemId: 'ent-read-phone',
      }),
    ])
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    expect(nodeById.get('entitlement:ent-read-phone')?.reviewStatus).toBe('revoked')
    expect(nodeById.get('source:src-phone')?.reviewStatus).toBeUndefined()
    const userToEnt = edges.find(
      (e) => e.from === 'user:u1' && e.to === 'entitlement:ent-read-phone',
    )
    expect(userToEnt?.reviewStatus).toBe('revoked')
    const entToSource = edges.find(
      (e) => e.from === 'entitlement:ent-read-phone' && e.to === 'source:src-phone',
    )
    expect(entToSource?.reviewStatus).toBeUndefined()
  })

  it('stamps a reassigned status on the user access-item node + user→item edge only', () => {
    const { nodes, edges } = deriveAccessGraph([
      row({
        id: '1',
        role: 'Role A',
        roleId: 'role-a',
        accessProfile: 'foo',
        accessProfileId: 'ap-foo',
        entitlement: 'read',
        entitlementId: 'ent-read-engr',
        source: 'engr db',
        sourceId: 'src-engr',
        reviewStatus: 'reassigned',
        accessItemKind: 'role',
        accessItemId: 'role-a',
      }),
    ])
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    expect(nodeById.get('role:role-a')?.reviewStatus).toBe('reassigned')
    expect(nodeById.get('user:u1')?.reviewStatus).toBeUndefined()
    expect(nodeById.get('accessProfile:ap-foo')?.reviewStatus).toBeUndefined()
    expect(nodeById.get('entitlement:ent-read-engr')?.reviewStatus).toBeUndefined()
    expect(nodeById.get('source:src-engr')?.reviewStatus).toBeUndefined()

    const edgeStatus = (from: string, to: string) =>
      edges.find((e) => e.from === from && e.to === to)?.reviewStatus
    expect(edgeStatus('user:u1', 'role:role-a')).toBe('reassigned')
    expect(edgeStatus('role:role-a', 'accessProfile:ap-foo')).toBeUndefined()
  })

  it('needsReview-wins over a reassigned access-item row', () => {
    // One reassigned row and one needs-review row for the same role: needsReview
    // outranks reassigned.
    const { nodes, edges } = deriveAccessGraph([
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
      row({
        id: '2',
        role: 'Role A',
        roleId: 'role-a',
        entitlement: 'write',
        entitlementId: 'e2',
        source: 'engr db',
        sourceId: 's1',
        reviewStatus: 'needsReview',
        accessItemKind: 'role',
        accessItemId: 'role-a',
      }),
    ])
    expect(nodes.find((n) => n.id === 'role:role-a')?.reviewStatus).toBe(
      'needsReview',
    )
    expect(
      edges.find((e) => e.from === 'user:u1' && e.to === 'role:role-a')
        ?.reviewStatus,
    ).toBe('needsReview')
  })

  it('applies needsReview-wins when an access-item node is reached from approved and incomplete rows', () => {
    // Two rows for the SAME role-a node: one approved, one needing review. The
    // node + user→role edge must end up needsReview.
    const { nodes, edges } = deriveAccessGraph([
      row({
        id: '1',
        role: 'Role A',
        roleId: 'role-a',
        entitlement: 'read',
        entitlementId: 'e1',
        source: 'engr db',
        sourceId: 's1',
        reviewStatus: 'approved',
        accessItemKind: 'role',
        accessItemId: 'role-a',
      }),
      row({
        id: '2',
        role: 'Role A',
        roleId: 'role-a',
        entitlement: 'write',
        entitlementId: 'e2',
        source: 'engr db',
        sourceId: 's1',
        reviewStatus: 'needsReview',
        accessItemKind: 'role',
        accessItemId: 'role-a',
      }),
    ])
    const roleNode = nodes.find((n) => n.id === 'role:role-a')
    expect(roleNode?.reviewStatus).toBe('needsReview')
    const userToRole = edges.find((e) => e.from === 'user:u1' && e.to === 'role:role-a')
    expect(userToRole?.reviewStatus).toBe('needsReview')
  })

  it('leaves status undefined everywhere for a degenerate access row (no access item)', () => {
    const { nodes } = deriveAccessGraph([
      row({
        id: 'blank',
        reviewStatus: 'needsReview',
        accessItemKind: undefined,
        accessItemId: null,
        unresolved: true,
      }),
    ])
    expect(nodes.every((n) => n.reviewStatus === undefined)).toBe(true)
  })

  it('contributes only the user node and zero edges for an all-blank-leaf access row', () => {
    const rows = [
      row({
        id: 'blank',
        role: '',
        accessProfile: '',
        entitlement: '',
        source: '',
        unresolved: true,
      }),
    ]
    const { nodes, edges } = deriveAccessGraph(rows)
    expect(nodes).toEqual([{ id: 'user:u1', kind: 'user', label: 'User One' }])
    expect(edges).toEqual([])
  })
})
