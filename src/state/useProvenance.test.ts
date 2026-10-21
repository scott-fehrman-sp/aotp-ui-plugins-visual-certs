import { renderHook, waitFor } from '@testing-library/react'
import type { AccessRequestsApi } from 'sailpoint-api-client/access_requests/api'
import type { IdentityHistoryApi } from 'sailpoint-api-client/identity_history/api'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewItemVM } from '../sailpoint/types'
import { useProvenance } from './useProvenance'

function item(overrides: Partial<ReviewItemVM>): ReviewItemVM {
  return {
    id: 'r1',
    identityId: 'id-1',
    completed: false,
    decision: null,
    reassigned: false,
    comments: null,
    personName: 'Alex',
    accessName: 'Admin Console',
    accessKind: 'entitlement',
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

/** A pair of fake API clients that resolve empty data (one call per identity). */
function fakeApis() {
  const listAccessRequestStatusV1 = vi.fn().mockResolvedValue({ data: [] })
  const getHistoricalIdentityEventsV1 = vi.fn().mockResolvedValue({ data: [] })
  return {
    accessRequestsApi: { listAccessRequestStatusV1 } as unknown as AccessRequestsApi,
    identityHistoryApi: {
      getHistoricalIdentityEventsV1,
    } as unknown as IdentityHistoryApi,
    listAccessRequestStatusV1,
    getHistoricalIdentityEventsV1,
  }
}

describe('useProvenance', () => {
  it('groups by identity and resolves each item to ready, one fetch per identity', async () => {
    const apis = fakeApis()
    const items = [
      item({ id: 'r1', identityId: 'id-1' }),
      item({ id: 'r2', identityId: 'id-1' }),
      item({ id: 'r3', identityId: 'id-2' }),
    ]
    const { result } = renderHook(() =>
      useProvenance(apis.accessRequestsApi, apis.identityHistoryApi, 'c1', items),
    )

    await waitFor(() =>
      expect(result.current.byItemId['r3']?.status).toBe('ready'),
    )
    expect(result.current.byItemId['r1'].status).toBe('ready')
    expect(result.current.byItemId['r2'].status).toBe('ready')
    // Two identities -> exactly two request calls, no per-item fan-out.
    expect(apis.listAccessRequestStatusV1).toHaveBeenCalledTimes(2)
  })

  it('marks items with no identityId unavailable and makes no call for them', async () => {
    const apis = fakeApis()
    const items = [item({ id: 'r1', identityId: '' })]
    const { result } = renderHook(() =>
      useProvenance(apis.accessRequestsApi, apis.identityHistoryApi, 'c1', items),
    )

    await waitFor(() =>
      expect(result.current.byItemId['r1']?.status).toBe('unavailable'),
    )
    expect(apis.listAccessRequestStatusV1).not.toHaveBeenCalled()
  })

  it('marks items unavailable on a hard request failure', async () => {
    const accessRequestsApi = {
      listAccessRequestStatusV1: vi
        .fn()
        .mockRejectedValue({ response: { status: 503 } }),
    } as unknown as AccessRequestsApi
    const identityHistoryApi = {
      getHistoricalIdentityEventsV1: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as IdentityHistoryApi
    const items = [item({ id: 'r1', identityId: 'id-1' })]
    const { result } = renderHook(() =>
      useProvenance(accessRequestsApi, identityHistoryApi, 'c1', items),
    )

    await waitFor(() =>
      expect(result.current.byItemId['r1']?.status).toBe('unavailable'),
    )
  })

  it('does not re-fetch or flash loading when a decision mutates items but preserves ids', async () => {
    const apis = fakeApis()
    const items = [item({ id: 'r1', identityId: 'id-1' })]
    const { result, rerender } = renderHook(
      ({ list }: { list: ReviewItemVM[] }) =>
        useProvenance(
          apis.accessRequestsApi,
          apis.identityHistoryApi,
          'c1',
          list,
        ),
      { initialProps: { list: items } },
    )

    await waitFor(() =>
      expect(result.current.byItemId['r1']?.status).toBe('ready'),
    )
    const callsAfterLoad = apis.listAccessRequestStatusV1.mock.calls.length

    // A decision replaces the array but keeps the id — mirrors useReviewItems.
    rerender({ list: [{ ...items[0], completed: true }] })

    expect(result.current.byItemId['r1'].status).toBe('ready')
    expect(apis.listAccessRequestStatusV1.mock.calls.length).toBe(callsAfterLoad)
  })

  it('re-resolves when the id set changes', async () => {
    const apis = fakeApis()
    const { result, rerender } = renderHook(
      ({ list }: { list: ReviewItemVM[] }) =>
        useProvenance(
          apis.accessRequestsApi,
          apis.identityHistoryApi,
          'c1',
          list,
        ),
      { initialProps: { list: [item({ id: 'r1', identityId: 'id-1' })] } },
    )

    await waitFor(() =>
      expect(result.current.byItemId['r1']?.status).toBe('ready'),
    )

    rerender({ list: [item({ id: 'r2', identityId: 'id-2' })] })

    await waitFor(() =>
      expect(result.current.byItemId['r2']?.status).toBe('ready'),
    )
    expect(apis.listAccessRequestStatusV1).toHaveBeenCalledTimes(2)
  })

  it('resets the resolver and clears entries on campaign change (shared identity re-fetched)', async () => {
    const apis = fakeApis()
    const items = [item({ id: 'r1', identityId: 'id-1' })]
    const { result, rerender } = renderHook(
      ({ campaignId }: { campaignId: string }) =>
        useProvenance(
          apis.accessRequestsApi,
          apis.identityHistoryApi,
          campaignId,
          items,
        ),
      { initialProps: { campaignId: 'c1' } },
    )

    await waitFor(() =>
      expect(result.current.byItemId['r1']?.status).toBe('ready'),
    )
    expect(apis.listAccessRequestStatusV1).toHaveBeenCalledTimes(1)

    // Same instance (no remount), new campaign — resolver must be recreated and
    // the shared identity re-fetched rather than served a stale cached promise.
    rerender({ campaignId: 'c2' })

    await waitFor(() =>
      expect(apis.listAccessRequestStatusV1).toHaveBeenCalledTimes(2),
    )
    // The call count reaches 2 as soon as the re-fetch STARTS; the entry only
    // flips back to 'ready' once it resolves. Wait for that too, otherwise a
    // loaded machine asserts while the entry is still 'loading'.
    await waitFor(() =>
      expect(result.current.byItemId['r1']?.status).toBe('ready'),
    )
  })
})
