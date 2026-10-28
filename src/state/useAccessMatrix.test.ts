import { act, renderHook, waitFor } from '@testing-library/react'
import type { AccessProfilesApi } from 'sailpoint-api-client/access_profiles/api'
import type { EntitlementsApi } from 'sailpoint-api-client/entitlements/api'
import type { IdentitiesApi } from 'sailpoint-api-client/identities/api'
import type { RolesApi } from 'sailpoint-api-client/roles/api'
import type { SourcesApi } from 'sailpoint-api-client/sources/api'
import { describe, expect, it, vi } from 'vitest'
import { createAccessCompositionResolver } from '../sailpoint/accessMatrix'
import type { AccessCompositionResolver } from '../sailpoint/accessMatrix'
import { emptyResolvedIdentity } from '../sailpoint/identities'
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

/** Mock API clients returning the worked-example composition, wrapped in a
 * real `createAccessCompositionResolver` so the per-id caches it builds in are
 * exercised exactly as `PluginRuntime` builds and shares them. */
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
  // Full identity detail lookup via IdentitiesApi.getIdentityV1.
  const getIdentityV1 = vi.fn().mockResolvedValue({
    data: {
      id: 'u1',
      emailAddress: 'user.one@example.com',
      isManager: true,
      managerRef: { id: 'mgr', name: 'Manager One' },
      lifecycleState: { stateName: 'active' },
      identityStatus: 'ACTIVE',
      attributes: { department: 'Engineering', location: 'Austin', title: 'Engineer' },
    },
  })
  const rolesApi = { getRoleV1 } as unknown as RolesApi
  const accessProfilesApi = { getAccessProfileV1 } as unknown as AccessProfilesApi
  const entitlementsApi = { getEntitlementV1, listEntitlementsV1: vi.fn() } as unknown as EntitlementsApi
  const sourcesApi = { getSourceV1 } as unknown as SourcesApi
  const identitiesApi = { getIdentityV1 } as unknown as IdentitiesApi
  return {
    resolver: createAccessCompositionResolver(
      rolesApi,
      accessProfilesApi,
      entitlementsApi,
      sourcesApi,
      identitiesApi,
    ),
    getRoleV1,
    getAccessProfileV1,
    getEntitlementV1,
    getSourceV1,
    getIdentityV1,
  }
}

function workedExampleItems(): ReviewItemVM[] {
  return [
    item({ id: 'rev-role', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' }),
    item({ id: 'rev-ap', accessKind: 'accessProfile', accessId: 'ap-bar', accessName: 'bar' }),
    item({ id: 'rev-ent', accessKind: 'entitlement', accessId: 'ent-read-phone', accessName: 'read' }),
  ]
}

describe('useAccessMatrix overview graph', () => {
  it('builds the ready overview graph synchronously with ZERO role/AP/entitlement/source API calls', async () => {
    const apis = fakeApis()
    const { result } = renderHook(() =>
      useAccessMatrix(apis.resolver, 'c1', workedExampleItems()),
    )

    expect(result.current.status).toBe('ready')
    // user + role-a + ap-bar + the directly-held entitlement = 4 nodes.
    expect(result.current.graph.nodes).toHaveLength(4)
    expect(result.current.graph.nodes.map((n) => n.kind).sort()).toEqual(
      ['accessProfile', 'entitlement', 'role', 'user'].sort(),
    )
    expect(apis.getRoleV1).not.toHaveBeenCalled()
    expect(apis.getAccessProfileV1).not.toHaveBeenCalled()
    expect(apis.getEntitlementV1).not.toHaveBeenCalled()
    expect(apis.getSourceV1).not.toHaveBeenCalled()

    // Identity detail is loaded for the grid, and only that. The composition
    // APIs stay idle.
    await waitFor(() => expect(result.current.identities.u1?.isManager).toBe('Yes'))
    expect(apis.getIdentityV1).toHaveBeenCalledTimes(1)
    expect(apis.getRoleV1).not.toHaveBeenCalled()
    expect(apis.getAccessProfileV1).not.toHaveBeenCalled()
    expect(apis.getEntitlementV1).not.toHaveBeenCalled()
    expect(apis.getSourceV1).not.toHaveBeenCalled()
    expect(result.current.graph.nodes).toHaveLength(4)
  })

  it('loads identity detail for every distinct user and caches it for a later selection', async () => {
    const apis = fakeApis()
    apis.getIdentityV1.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve({
        data: {
          id,
          firstName: id === 'u1' ? 'Ada' : 'Grace',
          lastName: id === 'u1' ? 'Lovelace' : 'Hopper',
          isManager: id === 'u2',
          attributes: {
            title: 'Engineer',
            department: 'Platform',
            location: 'Austin',
            country: 'USA',
          },
        },
      }),
    )
    const items = [
      item({ id: 'r1', identityId: 'u1', personName: 'User One' }),
      item({ id: 'r2', identityId: 'u1', personName: 'User One', accessId: 'role-b', accessName: 'Role B' }),
      item({ id: 'r3', identityId: 'u2', personName: 'User Two', accessId: 'role-c', accessName: 'Role C' }),
    ]
    const { result, rerender } = renderHook(
      ({ campaignId }: { campaignId: string }) => useAccessMatrix(apis.resolver, campaignId, items),
      { initialProps: { campaignId: 'c1' } },
    )
    const nodesBefore = result.current.graph.nodes

    await waitFor(() => expect(result.current.identities.u2?.lastName).toBe('Hopper'))
    expect(apis.getIdentityV1).toHaveBeenCalledTimes(2)
    expect(result.current.identities.u1).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      title: 'Engineer',
      department: 'Platform',
      location: 'Austin',
      country: 'USA',
      isManager: 'No',
    })
    expect(result.current.identities.u2?.isManager).toBe('Yes')
    // Filling identities must not replace the overview graph (that resets the grid).
    expect(result.current.graph.nodes).toBe(nodesBefore)
    expect(apis.getRoleV1).not.toHaveBeenCalled()

    rerender({ campaignId: 'c2' })
    await waitFor(() => expect(result.current.identities.u1?.firstName).toBe('Ada'))
    // Same resolver, same ids: the session cache serves both campaigns.
    expect(apis.getIdentityV1).toHaveBeenCalledTimes(2)
  })

  it('is idle with an empty graph until items load', () => {
    const apis = fakeApis()
    const { result } = renderHook(() => useAccessMatrix(apis.resolver, 'c1', null))
    expect(result.current.status).toBe('idle')
    expect(result.current.graph.nodes).toHaveLength(0)
  })

  it('does not rebuild the overview graph when items are rebuilt with the same ids', async () => {
    const apis = fakeApis()
    const items = workedExampleItems()
    const { result, rerender } = renderHook(
      ({ list }: { list: ReviewItemVM[] }) => useAccessMatrix(apis.resolver, 'c1', list),
      { initialProps: { list: items } },
    )
    const nodesBefore = result.current.graph.nodes

    rerender({ list: items.map((i) => ({ ...i, completed: true })) })

    expect(result.current.graph.nodes).toBe(nodesBefore)
    await waitFor(() => expect(result.current.identities.u1).toBeDefined())
    expect(result.current.graph.nodes).toBe(nodesBefore)
  })

  it('keeps graph.nodes reference stable while review status updates graph.edges', async () => {
    const apis = fakeApis()
    const items = workedExampleItems()
    const { result, rerender } = renderHook(
      ({ list }: { list: ReviewItemVM[] }) => useAccessMatrix(apis.resolver, 'c1', list),
      { initialProps: { list: items } },
    )
    const nodesBefore = result.current.graph.nodes
    const edgesBefore = result.current.graph.edges

    rerender({
      list: items.map((i) =>
        i.id === 'rev-role' ? { ...i, completed: true, decision: 'REVOKE' as const } : i,
      ),
    })

    expect(result.current.graph.nodes).toBe(nodesBefore)
    expect(result.current.graph.edges).not.toBe(edgesBefore)
    const roleEdge = result.current.graph.edges.find(
      (e) => e.from === 'user:u1' && e.to === 'role:role-a',
    )
    expect(roleEdge?.reviewStatus).toBe('revoked')
    await waitFor(() => expect(result.current.identities.u1).toBeDefined())
    expect(result.current.graph.nodes).toBe(nodesBefore)
  })
})

describe('useAccessMatrix resolveUser', () => {
  it('calls the composition APIs only once a user is selected for processing, and only for that user', async () => {
    const apis = fakeApis()
    const { result } = renderHook(() =>
      useAccessMatrix(apis.resolver, 'c1', workedExampleItems()),
    )
    expect(apis.getRoleV1).not.toHaveBeenCalled()

    act(() => result.current.resolveUser('u1'))
    expect(result.current.userDetails.u1?.status).toBe('loading')

    await waitFor(() => expect(result.current.userDetails.u1?.status).toBe('ready'))
    const detail = result.current.userDetails.u1!
    expect(detail.unresolvedCount).toBe(0)
    // 1 user + 1 role + 2 APs + 6 entitlements + 3 sources = 13.
    expect(detail.graph.nodes).toHaveLength(13)
    expect(apis.getRoleV1).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for a user already loading or ready (no duplicate API calls)', async () => {
    const apis = fakeApis()
    const { result } = renderHook(() =>
      useAccessMatrix(apis.resolver, 'c1', workedExampleItems()),
    )
    act(() => result.current.resolveUser('u1'))
    act(() => result.current.resolveUser('u1')) // while loading
    await waitFor(() => expect(result.current.userDetails.u1?.status).toBe('ready'))
    const callsAfterReady = apis.getRoleV1.mock.calls.length

    act(() => result.current.resolveUser('u1')) // while ready
    expect(apis.getRoleV1.mock.calls.length).toBe(callsAfterReady)
  })

  it('retries a user whose resolution errored', async () => {
    const identity = vi.fn()
    let failIdentity = true
    identity.mockImplementation(() =>
      failIdentity
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(emptyResolvedIdentity({ identityId: 'u1' })),
    )
    const resolver: AccessCompositionResolver = {
      role: vi.fn().mockResolvedValue(null),
      accessProfile: vi.fn().mockResolvedValue(null),
      entitlement: vi.fn().mockResolvedValue(null),
      entitlementByName: vi.fn().mockResolvedValue(null),
      source: vi.fn().mockResolvedValue(null),
      identity,
    }
    const { result } = renderHook(() =>
      useAccessMatrix(resolver, 'c1', [
        item({ id: 'rev-role', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' }),
      ]),
    )

    act(() => result.current.resolveUser('u1'))
    await waitFor(() => expect(result.current.userDetails.u1?.status).toBe('error'))
    expect(result.current.userDetails.u1?.error).toBeTruthy()

    failIdentity = false
    act(() => result.current.resolveUser('u1')) // retry
    await waitFor(() => expect(result.current.userDetails.u1?.status).toBe('ready'))
    expect(identity.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('records the identity before composition finishes, and keeps it once the graph is ready', async () => {
    let releaseRole: (value: null) => void = () => {}
    const roleGate = new Promise<null>((resolve) => {
      releaseRole = resolve
    })
    const identity = vi
      .fn()
      .mockResolvedValue(emptyResolvedIdentity({ identityId: 'u1', isManager: 'Yes' }))
    const resolver: AccessCompositionResolver = {
      role: vi.fn().mockImplementation(() => roleGate),
      accessProfile: vi.fn().mockResolvedValue(null),
      entitlement: vi.fn().mockResolvedValue(null),
      entitlementByName: vi.fn().mockResolvedValue(null),
      source: vi.fn().mockResolvedValue(null),
      identity,
    }
    const { result } = renderHook(() =>
      useAccessMatrix(resolver, 'c1', [
        item({ id: 'rev-role', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' }),
      ]),
    )

    act(() => result.current.resolveUser('u1'))
    await waitFor(() => expect(result.current.userDetails.u1?.identity?.isManager).toBe('Yes'))
    expect(result.current.userDetails.u1?.status).toBe('loading')

    releaseRole(null)
    await waitFor(() => expect(result.current.userDetails.u1?.status).toBe('ready'))
    expect(result.current.userDetails.u1?.identity?.isManager).toBe('Yes')
  })

  it('resets userDetails on a campaign switch, but reuses the resolver cache (no duplicate API calls across campaigns)', async () => {
    const apis = fakeApis()
    const { result, rerender } = renderHook(
      ({ campaignId }: { campaignId: string }) =>
        useAccessMatrix(apis.resolver, campaignId, workedExampleItems()),
      { initialProps: { campaignId: 'c1' } },
    )
    act(() => result.current.resolveUser('u1'))
    await waitFor(() => expect(result.current.userDetails.u1?.status).toBe('ready'))
    const roleCallsAfterC1 = apis.getRoleV1.mock.calls.length

    rerender({ campaignId: 'c2' })
    expect(result.current.userDetails).toEqual({})

    act(() => result.current.resolveUser('u1'))
    await waitFor(() => expect(result.current.userDetails.u1?.status).toBe('ready'))
    // Same resolver instance, same id already cached from c1: no new API call.
    expect(apis.getRoleV1.mock.calls.length).toBe(roleCallsAfterC1)
  })
})
