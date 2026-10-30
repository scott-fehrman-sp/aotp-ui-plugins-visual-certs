import { act, renderHook, waitFor } from '@testing-library/react'
import type { CertificationsApi } from 'sailpoint-api-client/certifications/api'
import { describe, expect, it, vi } from 'vitest'
import { reviewKey } from '../domain/reviewOverlay'
import type { ReviewItemVM } from '../sailpoint/types'
import { useDecisions } from './useDecisions'
import type { ReviewItemsState } from './useReviewItems'

const item: ReviewItemVM = {
  id: 'r1',
  identityId: 'id-r1',
  completed: false,
  decision: null,
  reassigned: false,
  comments: null,
  personName: 'Sam',
  accessName: 'Admin',
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
}

function makeReview(): ReviewItemsState {
  return {
    loading: false,
    error: null,
    items: [item],
    ordered: [],
    noRiskSignals: false,
    reload: vi.fn(),
    applyDecision: vi.fn(),
    applyReassign: vi.fn(),
    revertDecision: vi.fn(),
  }
}

describe('useDecisions', () => {
  it('optimistically applies, persists, and refreshes the campaign', async () => {
    const review = makeReview()
    const makeIdentityDecisionV1 = vi
      .fn()
      .mockResolvedValue({ data: { id: 'c1', decisionsMade: 1, decisionsTotal: 2 } })
    const api = { makeIdentityDecisionV1 } as unknown as CertificationsApi
    const onCampaignUpdated = vi.fn()

    const { result } = renderHook(() =>
      useDecisions({ api, campaignId: 'c1', review, onCampaignUpdated }),
    )

    act(() => result.current.open(item, 'allow'))
    expect(result.current.pending?.choice).toBe('allow')

    await act(async () => {
      await result.current.confirm('')
    })

    // Optimistic update happened before the API resolved.
    expect(review.applyDecision).toHaveBeenCalledWith('r1', 'APPROVE', null)
    expect(makeIdentityDecisionV1).toHaveBeenCalledWith({
      id: 'c1',
      reviewDecision: [{ id: 'r1', decision: 'APPROVE', bulk: false }],
    })
    expect(onCampaignUpdated).toHaveBeenCalled()
    expect(result.current.pending).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('passes a required comment through to the API', async () => {
    const review = makeReview()
    const makeIdentityDecisionV1 = vi
      .fn()
      .mockResolvedValue({ data: { id: 'c1' } })
    const api = { makeIdentityDecisionV1 } as unknown as CertificationsApi

    const { result } = renderHook(() =>
      useDecisions({
        api,
        campaignId: 'c1',
        review,
        onCampaignUpdated: vi.fn(),
      }),
    )

    act(() => result.current.open(item, 'remove'))
    await act(async () => {
      await result.current.confirm('No longer needed')
    })

    expect(makeIdentityDecisionV1).toHaveBeenCalledWith({
      id: 'c1',
      reviewDecision: [
        { id: 'r1', decision: 'REVOKE', bulk: false, comments: 'No longer needed' },
      ],
    })
  })

  it('rolls back and shows a friendly error when the API fails', async () => {
    const review = makeReview()
    const api = {
      makeIdentityDecisionV1: vi.fn().mockRejectedValue({ response: { status: 500 } }),
    } as unknown as CertificationsApi

    const { result } = renderHook(() =>
      useDecisions({
        api,
        campaignId: 'c1',
        review,
        onCampaignUpdated: vi.fn(),
      }),
    )

    act(() => result.current.open(item, 'remove'))
    await act(async () => {
      await result.current.confirm('Person changed roles')
    })

    expect(review.applyDecision).toHaveBeenCalled()
    expect(review.revertDecision).toHaveBeenCalledWith('r1')
    await waitFor(() => expect(result.current.error).toMatch(/problem on its end/i))
    // Dialog stays open so the user can retry or cancel.
    expect(result.current.pending).not.toBeNull()
  })

  describe('confirmReassign', () => {
    it('optimistically applies, reassigns, and refreshes the campaign', async () => {
      const review = makeReview()
      const reassignIdentityCertificationsV1 = vi
        .fn()
        .mockResolvedValue({ data: { id: 'c1', decisionsMade: 1, decisionsTotal: 2 } })
      const api = { reassignIdentityCertificationsV1 } as unknown as CertificationsApi
      const onCampaignUpdated = vi.fn()

      const { result } = renderHook(() =>
        useDecisions({ api, campaignId: 'c1', review, onCampaignUpdated }),
      )

      act(() => result.current.open(item, 'reassign'))
      await act(async () => {
        await result.current.confirmReassign('i9', 'Another manager owns this')
      })

      // Optimistic reassign marked the item before the API resolved.
      expect(review.applyReassign).toHaveBeenCalledWith('r1', 'Another manager owns this')
      // The reassign body carries the certification id, item ref, recipient, and reason.
      expect(reassignIdentityCertificationsV1).toHaveBeenCalledWith({
        id: 'c1',
        reviewReassign: {
          reassign: [{ id: 'r1', type: 'ITEM' }],
          reassignTo: 'i9',
          reason: 'Another manager owns this',
        },
      })
      expect(onCampaignUpdated).toHaveBeenCalled()
      expect(result.current.pending).toBeNull()
      expect(result.current.error).toBeNull()
    })

    it('rolls back and shows a friendly error when the reassign fails', async () => {
      const review = makeReview()
      const api = {
        reassignIdentityCertificationsV1: vi
          .fn()
          .mockRejectedValue({ response: { status: 500 } }),
      } as unknown as CertificationsApi

      const { result } = renderHook(() =>
        useDecisions({ api, campaignId: 'c1', review, onCampaignUpdated: vi.fn() }),
      )

      act(() => result.current.open(item, 'reassign'))
      await act(async () => {
        await result.current.confirmReassign('i9', 'Another manager owns this')
      })

      expect(review.applyReassign).toHaveBeenCalled()
      expect(review.revertDecision).toHaveBeenCalledWith('r1')
      await waitFor(() => expect(result.current.error).toMatch(/problem on its end/i))
      // Dialog stays open so the user can retry or cancel.
      expect(result.current.pending).not.toBeNull()
    })
  })

  describe('confirmAccess', () => {
    const role = {
      ...item,
      id: 'r1',
      identityId: 'u1',
      accessKind: 'role' as const,
      accessId: 'role-a',
      accessName: 'Role A',
    }
    const login = {
      ...item,
      id: 'r2',
      identityId: 'u1',
      accessKind: 'entitlement' as const,
      accessId: 'e-login',
      accessName: 'Login',
    }
    const keys = [
      reviewKey('u1', 'role', 'role-a', 'Role A'),
      reviewKey('u1', 'entitlement', 'e-login', 'Login'),
    ]

    function reviewOf(items: ReviewItemVM[]): ReviewItemsState {
      return { ...makeReview(), items }
    }

    it('approves every matching item in one bulk decision', async () => {
      const review = reviewOf([role, login])
      const makeIdentityDecisionV1 = vi
        .fn()
        .mockResolvedValue({ data: { id: 'c1', decisionsMade: 2, decisionsTotal: 2 } })
      const onCampaignUpdated = vi.fn()
      const { result } = renderHook(() =>
        useDecisions({
          api: { makeIdentityDecisionV1 } as unknown as CertificationsApi,
          campaignId: 'c1',
          review,
          onCampaignUpdated,
        }),
      )

      await act(async () => {
        await result.current.confirmAccess({
          action: 'approve',
          reviewKeys: keys,
          comment: 'Reviewed and appropriate for their role',
        })
      })

      expect(review.applyDecision).toHaveBeenCalledWith(
        'r1',
        'APPROVE',
        'Reviewed and appropriate for their role',
      )
      expect(review.applyDecision).toHaveBeenCalledWith(
        'r2',
        'APPROVE',
        'Reviewed and appropriate for their role',
      )
      expect(makeIdentityDecisionV1).toHaveBeenCalledWith({
        id: 'c1',
        reviewDecision: [
          {
            id: 'r1',
            decision: 'APPROVE',
            bulk: true,
            comments: 'Reviewed and appropriate for their role',
          },
          {
            id: 'r2',
            decision: 'APPROVE',
            bulk: true,
            comments: 'Reviewed and appropriate for their role',
          },
        ],
      })
      expect(onCampaignUpdated).toHaveBeenCalled()
      expect(result.current.error).toBeNull()
    })

    it('refuses to revoke when any selected item cannot be revoked', async () => {
      const review = reviewOf([{ ...login, revocable: false }])
      const makeIdentityDecisionV1 = vi.fn()
      const { result } = renderHook(() =>
        useDecisions({
          api: { makeIdentityDecisionV1 } as unknown as CertificationsApi,
          campaignId: 'c1',
          review,
          onCampaignUpdated: vi.fn(),
        }),
      )

      await act(async () => {
        await expect(
          result.current.confirmAccess({
            action: 'revoke',
            reviewKeys: [keys[1]],
            comment: 'No longer needed for their job',
          }),
        ).rejects.toThrow(/can't be revoked/)
      })

      expect(makeIdentityDecisionV1).not.toHaveBeenCalled()
      expect(review.applyDecision).not.toHaveBeenCalled()
      expect(result.current.error).toMatch(/can't be revoked/)
    })

    it('reassigns every matching item to the chosen person', async () => {
      const review = reviewOf([role, login])
      const reassignIdentityCertificationsV1 = vi
        .fn()
        .mockResolvedValue({ data: { id: 'c1' } })
      const { result } = renderHook(() =>
        useDecisions({
          api: { reassignIdentityCertificationsV1 } as unknown as CertificationsApi,
          campaignId: 'c1',
          review,
          onCampaignUpdated: vi.fn(),
        }),
      )

      await act(async () => {
        await result.current.confirmAccess({
          action: 'reassign',
          reviewKeys: keys,
          comment: 'This belongs to another manager.',
          reassignToId: 'i9',
        })
      })

      expect(review.applyReassign).toHaveBeenCalledWith('r1', 'This belongs to another manager.')
      expect(review.applyReassign).toHaveBeenCalledWith('r2', 'This belongs to another manager.')
      expect(reassignIdentityCertificationsV1).toHaveBeenCalledWith({
        id: 'c1',
        reviewReassign: {
          reassign: [
            { id: 'r1', type: 'ITEM' },
            { id: 'r2', type: 'ITEM' },
          ],
          reassignTo: 'i9',
          reason: 'This belongs to another manager.',
        },
      })
    })

    it('rolls back every item when the bulk decision fails', async () => {
      const review = reviewOf([role, login])
      const { result } = renderHook(() =>
        useDecisions({
          api: {
            makeIdentityDecisionV1: vi.fn().mockRejectedValue({ response: { status: 500 } }),
          } as unknown as CertificationsApi,
          campaignId: 'c1',
          review,
          onCampaignUpdated: vi.fn(),
        }),
      )

      await act(async () => {
        await expect(
          result.current.confirmAccess({
            action: 'revoke',
            reviewKeys: keys,
            comment: 'Unused access',
          }),
        ).rejects.toThrow(/problem on its end/i)
      })

      expect(review.revertDecision).toHaveBeenCalledWith('r1')
      expect(review.revertDecision).toHaveBeenCalledWith('r2')
      expect(result.current.error).toMatch(/problem on its end/i)
    })
  })
})
