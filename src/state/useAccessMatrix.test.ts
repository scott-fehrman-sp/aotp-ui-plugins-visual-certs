import { renderHook, waitFor } from '@testing-library/react'
import type { AccessProfilesApi } from 'sailpoint-api-client/access_profiles/api'
import type { EntitlementsApi } from 'sailpoint-api-client/entitlements/api'
import type { RolesApi } from 'sailpoint-api-client/roles/api'
import type { SearchApi } from 'sailpoint-api-client/search/api'
import type { SourcesApi } from 'sailpoint-api-client/sources/api'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewItemVM } from '../sailpoint/types'
import { useAccessMatrix } from './useAccessMatrix'

function item(overrides: Partial<ReviewItemVM>): ReviewItemVM {
  return {
    id: 'r1',
    identityId: 'u1',
    completed: false,
    decision: null,
    reassigned: false,
    comments: null,
    personName: 'User One',
    accessName: 'access',
    accessKind: 'access',
    accessId: null,
    accessDescription: null,
    sourceName: null,
    isNewAccess: false,
    isPrivileged: false,
    isCloudGoverned: false,
    dataImpact: null,
    usageDays: null,
    aiRecommendation: null,
    revocable: true,
    ...overrides,
  }
}

/** Mock API clients returning the worked-example composition. */
function fakeApis() {
  const getRoleV1 = vi.fn().mockResolvedValue({
    data: {
      id: 'role-a',
      name: 'Role A',
      accessProfiles: [{ id: 'ap-foo', name: 'foo' }],
      entitlements: [{ id: 'ent-delete-engr', name: 'delete' }],
    },
  })
  const getAccessProfileV1 = vi.fn().mockImplementation(({ id }) => {
    const bodies: Record<string, unknown> = {
      'ap-foo': {
        id: 'ap-foo',
        name: 'foo',
        source: { id: 'src-engr', name: 'engr db' },
        entitlements: [
          { id: 'ent-read-engr', name: 'read' },
          { id: 'ent-write-engr', name: 'write' },
        ],
      },
      'ap-bar': {
        id: 'ap-bar',
        name: 'bar',
        source: { id: 'src-acct', name: 'accounting db' },
        entitlements: [
          { id: 'ent-read-acct', name: 'read' },
          { id: 'ent-search-acct', name: 'search' },
        ],
      },
    }
    return Promise.resolve({ data: bodies[id] })
  })
  const getEntitlementV1 = vi.fn().mockImplementation(({ id }) => {
    const sources: Record<string, { id: string; name: string }> = {
      'ent-read-engr': { id: 'src-engr', name: 'engr db' },
      'ent-write-engr': { id: 'src-engr', name: 'engr db' },
      'ent-delete-engr': { id: 'src-engr', name: 'engr db' },
      'ent-read-acct': { id: 'src-acct', name: 'accounting db' },
      'ent-search-acct': { id: 'src-acct', name: 'accounting db' },
      'ent-read-phone': { id: 'src-phone', name: 'phone app' },
    }
    const names: Record<string, string> = {
      'ent-read-engr': 'read',
      'ent-write-engr': 'write',
      'ent-delete-engr': 'delete',
      'ent-read-acct': 'read',
      'ent-search-acct': 'search',
      'ent-read-phone': 'read',
    }
    return Promise.resolve({
      data: { id, name: names[id], source: sources[id] },
    })
  })
  // Source descriptions for the graph tooltip; one body per source id.
  const getSourceV1 = vi.fn().mockImplementation(({ id }) => {
    const descriptions: Record<string, string> = {
      'src-engr': 'Engineering database',
      'src-acct': 'Accounting database',
      'src-phone': 'Phone application',
    }
    return Promise.resolve({
      data: { id, name: id, description: descriptions[id] ?? '' },
    })
  })
  // Identity department/location lookup via the search index.
  const searchPostV1 = vi.fn().mockResolvedValue({
    data: [{ id: 'u1', attributes: { department: 'Engineering', location: 'Austin' } }],
  })
  return {
    rolesApi: { getRoleV1 } as unknown as RolesApi,
    accessProfilesApi: { getAccessProfileV1 } as unknown as AccessProfilesApi,
    entitlementsApi: { getEntitlementV1 } as unknown as EntitlementsApi,
    sourcesApi: { getSourceV1 } as unknown as SourcesApi,
    searchApi: { searchPostV1 } as unknown as SearchApi,
    getRoleV1,
    getAccessProfileV1,
    getEntitlementV1,
    getSourceV1,
    searchPostV1,
  }
}

function workedExampleItems(): ReviewItemVM[] {
  return [
    item({ id: 'rev-role', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' }),
    item({ id: 'rev-ap', accessKind: 'accessProfile', accessId: 'ap-bar', accessName: 'bar' }),
    item({ id: 'rev-ent', accessKind: 'entitlement', accessId: 'ent-read-phone', accessName: 'read' }),
  ]
}

describe('useAccessMatrix', () => {
  it('resolves to ready with 6 rows and the expected graph node count', async () => {
    const apis = fakeApis()
    const { result } = renderHook(() =>
      useAccessMatrix(
        apis.rolesApi,
        apis.accessProfilesApi,
        apis.entitlementsApi,
        apis.sourcesApi,
        apis.searchApi,
        'c1',
        workedExampleItems(),
      ),
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.rows).toHaveLength(6)
    // Nodes: 1 user + 1 role + 2 APs + 6 entitlements + 3 sources = 13.
    expect(result.current.graph.nodes).toHaveLength(13)
    expect(result.current.unresolvedCount).toBe(0)
  })

  it('does not re-resolve when items are rebuilt with the same ids', async () => {
    const apis = fakeApis()
    const items = workedExampleItems()
    const { result, rerender } = renderHook(
      ({ list }: { list: ReviewItemVM[] }) =>
        useAccessMatrix(
          apis.rolesApi,
          apis.accessProfilesApi,
          apis.entitlementsApi,
          apis.sourcesApi,
          apis.searchApi,
          'c1',
          list,
        ),
      { initialProps: { list: items } },
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const callsAfterLoad = apis.getEntitlementV1.mock.calls.length
    const roleCallsAfterLoad = apis.getRoleV1.mock.calls.length
    const apCallsAfterLoad = apis.getAccessProfileV1.mock.calls.length

    // Rebuild the array but preserve ids (mirrors a decision update).
    rerender({ list: items.map((i) => ({ ...i, completed: true })) })

    expect(result.current.status).toBe('ready')
    expect(apis.getEntitlementV1.mock.calls.length).toBe(callsAfterLoad)
    expect(apis.getRoleV1.mock.calls.length).toBe(roleCallsAfterLoad)
    expect(apis.getAccessProfileV1.mock.calls.length).toBe(apCallsAfterLoad)
  })

  it('keeps graph.nodes reference stable across status-only rebuilds', async () => {
    const apis = fakeApis()
    const items = workedExampleItems()
    const { result, rerender } = renderHook(
      ({ list }: { list: ReviewItemVM[] }) =>
        useAccessMatrix(
          apis.rolesApi,
          apis.accessProfilesApi,
          apis.entitlementsApi,
          apis.sourcesApi,
          apis.searchApi,
          'c1',
          list,
        ),
      { initialProps: { list: items } },
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const nodesBefore = result.current.graph.nodes
    const edgesBefore = result.current.graph.edges

    rerender({ list: items.map((i) => ({ ...i, completed: true, decision: 'REVOKE' as const })) })

    expect(result.current.graph.nodes).toBe(nodesBefore)
    expect(result.current.graph.edges).not.toBe(edgesBefore)
    const roleEdge = result.current.graph.edges.find(
      (e) => e.from === 'user:u1' && e.to === 'role:role-a',
    )
    expect(roleEdge?.reviewStatus).toBe('revoked')
  })

  it('reflects a decision made after resolution in graph edge status without re-resolving', async () => {
    const apis = fakeApis()
    const items = workedExampleItems()
    const { result, rerender } = renderHook(
      ({ list }: { list: ReviewItemVM[] }) =>
        useAccessMatrix(
          apis.rolesApi,
          apis.accessProfilesApi,
          apis.entitlementsApi,
          apis.sourcesApi,
          apis.searchApi,
          'c1',
          list,
        ),
      { initialProps: { list: items } },
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const roleEdge = () =>
      result.current.graph.edges.find(
        (e) => e.from === 'user:u1' && e.to === 'role:role-a',
      )
    expect(roleEdge()?.reviewStatus).toBe('needsReview')
    const roleCalls = apis.getRoleV1.mock.calls.length
    const entCalls = apis.getEntitlementV1.mock.calls.length

    // The reviewer keeps the role AFTER resolution (same ids, new decision).
    rerender({
      list: items.map((i) =>
        i.id === 'rev-role'
          ? { ...i, completed: true, decision: 'APPROVE' as const }
          : i,
      ),
    })

    expect(roleEdge()?.reviewStatus).toBe('approved')
    expect(apis.getRoleV1.mock.calls.length).toBe(roleCalls)
    expect(apis.getEntitlementV1.mock.calls.length).toBe(entCalls)
  })
})
