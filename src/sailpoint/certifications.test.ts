import type { CertificationsApi } from 'sailpoint-api-client/certifications/api'
import { describe, expect, it, vi } from 'vitest'
import {
  FriendlyError,
  decide,
  getCampaign,
  listMyCampaigns,
  listReviewItems,
  reassignReviewItem,
  signOff,
  toCampaignVM,
  toReviewItemVM,
} from './certifications'

/** Builds a fake CertificationsApi with only the methods under test. */
function fakeApi(overrides: Partial<CertificationsApi>): CertificationsApi {
  return overrides as unknown as CertificationsApi
}

describe('toCampaignVM', () => {
  it('normalizes progress, phase, and comment requirement', () => {
    const vm = toCampaignVM({
      id: 'c1',
      name: 'Quarterly manager review',
      decisionsMade: 3,
      decisionsTotal: 10,
      due: '2026-12-01T00:00:00Z',
      phase: 'ACTIVE',
      campaign: {
        id: 'camp1',
        name: 'Q4',
        type: 'CAMPAIGN',
        campaignType: 'MANAGER',
        description: 'Review your team',
        correlatedStatus: 'CORRELATED',
        mandatoryCommentRequirement: 'REVOKE_ONLY_DECISIONS',
      },
    })

    expect(vm).toMatchObject({
      id: 'c1',
      name: 'Quarterly manager review',
      description: 'Review your team',
      phase: 'inProgress',
      decisionsMade: 3,
      decisionsTotal: 10,
      commentRequirement: 'revokeOnly',
    })
  })

  it('treats a signed certification as done', () => {
    const vm = toCampaignVM({ id: 'c2', signed: '2026-01-01T00:00:00Z' })
    expect(vm.phase).toBe('done')
  })
})

describe('toReviewItemVM', () => {
  it('extracts entitlement details and risk signals', () => {
    const vm = toReviewItemVM({
      id: 'r1',
      completed: false,
      newAccess: true,
      identitySummary: { id: 's1', name: 'Alex Kim' },
      accessSummary: {
        access: { type: 'ENTITLEMENT', id: 'e1', name: 'Admin Console' },
        entitlement: {
          id: 'e1',
          name: 'Admin Console',
          description: 'Full admin access',
          sourceName: 'Finance App',
          privileged: true,
          cloudGoverned: true,
          revocable: true,
          dataAccess: { impactScore: { value: 'HIGH' } },
          account: { activityInsights: { usageDays: 0, usageDaysState: 'COMPLETE' } },
        },
      },
    })

    expect(vm).toMatchObject({
      id: 'r1',
      personName: 'Alex Kim',
      accessName: 'Admin Console',
      accessKind: 'entitlement',
      sourceName: 'Finance App',
      isNewAccess: true,
      isPrivileged: true,
      isCloudGoverned: true,
      dataImpact: 'high',
      usageDays: 0,
      revocable: true,
    })
  })

  it('falls back gracefully when fields are missing', () => {
    const vm = toReviewItemVM({ id: 'r2' })
    expect(vm.personName).toBe('this person')
    expect(vm.accessName).toBe('this access')
    expect(vm.accessKind).toBe('access')
    expect(vm.dataImpact).toBeNull()
  })
})

describe('API wrappers', () => {
  it('listMyCampaigns scopes to the current reviewer and maps results', async () => {
    const listIdentityCertificationsV1 = vi.fn().mockResolvedValue({
      data: [{ id: 'c1', name: 'Review', decisionsMade: 0, decisionsTotal: 5 }],
    })
    const api = fakeApi({ listIdentityCertificationsV1 })

    const campaigns = await listMyCampaigns(api)

    expect(listIdentityCertificationsV1).toHaveBeenCalledWith(
      expect.objectContaining({ reviewerIdentity: 'me' }),
    )
    expect(campaigns).toHaveLength(1)
    expect(campaigns[0].name).toBe('Review')
  })

  it('getCampaign returns a normalized campaign', async () => {
    const api = fakeApi({
      getIdentityCertificationV1: vi
        .fn()
        .mockResolvedValue({ data: { id: 'c1', name: 'Review' } }),
    })
    const vm = await getCampaign(api, 'c1')
    expect(vm.id).toBe('c1')
  })

  it('listReviewItems pages until a short page is returned', async () => {
    const fullPage = Array.from({ length: 250 }, (_, i) => ({ id: `r${i}` }))
    const listIdentityAccessReviewItemsV1 = vi
      .fn()
      .mockResolvedValueOnce({ data: fullPage })
      .mockResolvedValueOnce({ data: [{ id: 'last' }] })
    const api = fakeApi({ listIdentityAccessReviewItemsV1 })

    const items = await listReviewItems(api, 'c1')

    expect(listIdentityAccessReviewItemsV1).toHaveBeenCalledTimes(2)
    expect(items).toHaveLength(251)
  })

  it('decide maps allow/remove to APPROVE/REVOKE and attaches comments', async () => {
    const makeIdentityDecisionV1 = vi
      .fn()
      .mockResolvedValue({ data: { id: 'c1', decisionsMade: 2, decisionsTotal: 5 } })
    const api = fakeApi({ makeIdentityDecisionV1 })

    await decide(api, 'c1', [
      { itemId: 'r1', choice: 'allow' },
      { itemId: 'r2', choice: 'remove', comment: 'No longer needed' },
    ])

    expect(makeIdentityDecisionV1).toHaveBeenCalledWith({
      id: 'c1',
      reviewDecision: [
        { id: 'r1', decision: 'APPROVE', bulk: false },
        { id: 'r2', decision: 'REVOKE', bulk: false, comments: 'No longer needed' },
      ],
    })
  })

  it('reassignReviewItem builds an ITEM reassign and maps the campaign', async () => {
    const reassignIdentityCertificationsV1 = vi
      .fn()
      .mockResolvedValue({ data: { id: 'c1', decisionsMade: 1, decisionsTotal: 5 } })
    const api = fakeApi({ reassignIdentityCertificationsV1 })

    const vm = await reassignReviewItem(api, {
      certificationId: 'c1',
      itemId: 'r1',
      reassignToId: 'identity-9',
      reason: 'This belongs to another manager.',
    })

    expect(reassignIdentityCertificationsV1).toHaveBeenCalledWith({
      id: 'c1',
      reviewReassign: {
        reassign: [{ id: 'r1', type: 'ITEM' }],
        reassignTo: 'identity-9',
        reason: 'This belongs to another manager.',
      },
    })
    expect(vm.id).toBe('c1')
  })

  it('reassignReviewItem maps HTTP errors to a FriendlyError', async () => {
    const api = fakeApi({
      reassignIdentityCertificationsV1: vi
        .fn()
        .mockRejectedValue({ response: { status: 403 } }),
    })

    await expect(
      reassignReviewItem(api, {
        certificationId: 'c1',
        itemId: 'r1',
        reassignToId: 'identity-9',
        reason: 'x',
      }),
    ).rejects.toBeInstanceOf(FriendlyError)
  })

  it('toReviewItemVM reflects a reassigned item', () => {
    const vm = toReviewItemVM({ id: 'r1', reassigned: true } as never)
    expect(vm.reassigned).toBe(true)
    expect(toReviewItemVM({ id: 'r2' }).reassigned).toBe(false)
  })

  it('signOff calls the finalize endpoint', async () => {
    const signOffIdentityCertificationV1 = vi
      .fn()
      .mockResolvedValue({ data: { id: 'c1', signed: '2026-01-01T00:00:00Z' } })
    const api = fakeApi({ signOffIdentityCertificationV1 })

    const vm = await signOff(api, 'c1')

    expect(signOffIdentityCertificationV1).toHaveBeenCalledWith({ id: 'c1' })
    expect(vm.phase).toBe('done')
  })

  it('maps a 403 into a friendly permission message', async () => {
    const api = fakeApi({
      listIdentityCertificationsV1: vi
        .fn()
        .mockRejectedValue({ response: { status: 403 } }),
    })

    await expect(listMyCampaigns(api)).rejects.toBeInstanceOf(FriendlyError)
    await expect(listMyCampaigns(api)).rejects.toThrow(/permission/i)
  })

  it('maps a 500 into a friendly retry message', async () => {
    const api = fakeApi({
      getIdentityCertificationV1: vi
        .fn()
        .mockRejectedValue({ status: 500 }),
    })

    await expect(getCampaign(api, 'c1')).rejects.toThrow(/problem on its end/i)
  })
})
