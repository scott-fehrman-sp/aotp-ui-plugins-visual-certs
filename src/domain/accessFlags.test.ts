import { describe, expect, it } from 'vitest'
import { reviewItem } from '../test/reviewStatusFixture'
import { accessFlagDetails, mergeAccessFlags } from './accessFlags'

describe('accessFlagDetails', () => {
  it('lists an entitlement’s review flags in help order, with notes', () => {
    const details = accessFlagDetails(
      reviewItem({
        accessKind: 'entitlement',
        isNewAccess: true,
        isPrivileged: true,
        isBirthright: true,
        isCloudGoverned: true,
        dataImpact: 'high',
        comments: '  Still needed  ',
        accessEndDate: '2027-01-15T00:00:00.000Z',
      }),
    )

    expect(details.map((detail) => detail.flag)).toEqual([
      'newAccess',
      'birthright',
      'highPrivilege',
      'timebound',
      'comments',
      'cloudEnabled',
      'criticalData',
    ])
    expect(details.find((detail) => detail.flag === 'comments')?.note).toBe('Still needed')
    expect(details.find((detail) => detail.flag === 'timebound')?.note).toBe('Ends Jan 15, 2027')
    expect(details.find((detail) => detail.flag === 'criticalData')?.note).toBe('Impact: High')
  })

  it('uses Contains Privileged Access for a role or access profile', () => {
    const details = accessFlagDetails(
      reviewItem({ accessKind: 'role', isPrivileged: true }),
    )
    expect(details.map((detail) => detail.flag)).toEqual(['containsPrivileged'])
  })

  it('does not call a non-overridden privilege level an override', () => {
    const details = accessFlagDetails(
      reviewItem({
        accessKind: 'entitlement',
        isPrivileged: true,
        privilegeOverridden: false,
      }),
    )
    expect(details).toEqual([])
  })

  it('raises critical data when DAS is present without an impact score', () => {
    const details = accessFlagDetails(
      reviewItem({ accessKind: 'entitlement', hasCriticalData: true, dataImpact: null }),
    )
    expect(details.map((detail) => detail.flag)).toEqual(['criticalData'])
    expect(details[0].note).toBeUndefined()
  })
})

describe('mergeAccessFlags', () => {
  it('unions flags in display order', () => {
    expect(mergeAccessFlags(['cloudEnabled', 'newAccess'], ['newAccess', 'comments'])).toEqual([
      'newAccess',
      'comments',
      'cloudEnabled',
    ])
  })
})
