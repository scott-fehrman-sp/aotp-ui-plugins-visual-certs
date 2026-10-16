import type { RequestedItemStatus } from 'sailpoint-api-client/access_requests/api'
import type { GetHistoricalIdentityEventsV1200ResponseInner } from 'sailpoint-api-client/identity_history/api'
import { describe, expect, it, vi } from 'vitest'
import {
  createProvenanceResolver,
  matchRequest,
  toProvenanceVM,
} from './provenance'
import type { RawIdentityProvenance } from './provenance'
import type { ReviewItemVM } from './types'

type HistoricalEvent = GetHistoricalIdentityEventsV1200ResponseInner

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

function raw(overrides: Partial<RawIdentityProvenance>): RawIdentityProvenance {
  return { requests: [], events: null, requestsFailedHard: false, ...overrides }
}

describe('matchRequest', () => {
  it('matches on name + type, case-insensitively and trimmed', () => {
    const requests: RequestedItemStatus[] = [
      { name: '  admin console ', type: 'ENTITLEMENT', created: '2024-01-01T00:00:00Z' },
      { name: 'Other', type: 'ENTITLEMENT', created: '2024-02-01T00:00:00Z' },
    ]
    const match = matchRequest(item({ accessName: 'Admin Console' }), requests)
    expect(match?.name).toBe('  admin console ')
  })

  it('prefers the most recently created row on a multi-match', () => {
    const requests: RequestedItemStatus[] = [
      { name: 'Admin Console', type: 'ENTITLEMENT', created: '2023-01-01T00:00:00Z' },
      { name: 'Admin Console', type: 'ENTITLEMENT', created: '2024-06-01T00:00:00Z' },
      { name: 'Admin Console', type: 'ENTITLEMENT', created: '2022-01-01T00:00:00Z' },
    ]
    const match = matchRequest(item({}), requests)
    expect(match?.created).toBe('2024-06-01T00:00:00Z')
  })

  it('does not match a typed item against a null-type row', () => {
    const requests: RequestedItemStatus[] = [
      { name: 'Admin Console', type: null, created: '2024-01-01T00:00:00Z' },
    ]
    expect(matchRequest(item({ accessKind: 'entitlement' }), requests)).toBeNull()
  })

  it('matches the access fallback on name only (null-type row included)', () => {
    const requests: RequestedItemStatus[] = [
      { name: 'Mystery grant', type: null, created: '2024-01-01T00:00:00Z' },
    ]
    const match = matchRequest(
      item({ accessKind: 'access', accessName: 'Mystery grant' }),
      requests,
    )
    expect(match?.name).toBe('Mystery grant')
  })

  it('treats the "this access" sentinel as non-matching for the access fallback', () => {
    const requests: RequestedItemStatus[] = [
      { name: 'this access', type: null, created: '2024-01-01T00:00:00Z' },
    ]
    expect(
      matchRequest(item({ accessKind: 'access', accessName: 'this access' }), requests),
    ).toBeNull()
  })

  it('treats an empty/whitespace name as non-matching for the access fallback', () => {
    const requests: RequestedItemStatus[] = [
      { name: '   ', type: null, created: '2024-01-01T00:00:00Z' },
    ]
    expect(
      matchRequest(item({ accessKind: 'access', accessName: '   ' }), requests),
    ).toBeNull()
  })

  it('returns null when nothing matches', () => {
    const requests: RequestedItemStatus[] = [
      { name: 'Something else', type: 'ROLE', created: '2024-01-01T00:00:00Z' },
    ]
    expect(matchRequest(item({}), requests)).toBeNull()
  })
})

describe('toProvenanceVM', () => {
  it('labels a role item as "Part of a role" without needing history', () => {
    const vm = toProvenanceVM(
      item({ accessKind: 'role', accessName: 'Finance Manager' }),
      raw({}),
    )
    expect(vm.grantMechanism).toBe('role')
    expect(vm.mechanismLabel).toBe('Part of a role')
    expect(vm.request).toBeNull()
  })

  it('maps a matching request row into a multi-step approval chain', () => {
    const requests: RequestedItemStatus[] = [
      {
        name: 'Admin Console',
        type: 'ENTITLEMENT',
        created: '2024-03-01T00:00:00Z',
        requester: { name: 'Dana Requester' },
        requesterComment: { comment: 'Need it for the audit' },
        approvalDetails: [
          {
            currentOwner: { name: 'Mel Manager' },
            status: 'APPROVED',
            modified: '2024-03-02T00:00:00Z',
            comment: 'Looks fine',
          },
          {
            currentOwner: { name: 'Sec Team' },
            status: 'PENDING',
            modified: null,
            comment: null,
          },
        ],
      },
    ]
    const vm = toProvenanceVM(item({}), raw({ requests }))
    expect(vm.grantMechanism).toBe('request')
    expect(vm.mechanismLabel).toBe('Via access request')
    expect(vm.request).toEqual({
      requestedBy: 'Dana Requester',
      requestedOn: '2024-03-01T00:00:00Z',
      justification: 'Need it for the audit',
    })
    expect(vm.approvals).toEqual([
      {
        approver: 'Mel Manager',
        decision: 'approved',
        decidedOn: '2024-03-02T00:00:00Z',
        comment: 'Looks fine',
      },
      {
        approver: 'Sec Team',
        decision: 'pending',
        decidedOn: null,
        comment: null,
      },
    ])
  })

  it('maps every ManualWorkItemState to a plain decision', () => {
    const states = [
      ['APPROVED', 'approved'],
      ['REJECTED', 'rejected'],
      ['PENDING', 'pending'],
      ['EXPIRED', 'unknown'],
      ['CANCELLED', 'unknown'],
      ['ARCHIVED', 'unknown'],
    ] as const
    for (const [status, expected] of states) {
      const requests: RequestedItemStatus[] = [
        {
          name: 'Admin Console',
          type: 'ENTITLEMENT',
          created: '2024-03-01T00:00:00Z',
          approvalDetails: [{ status }],
        },
      ]
      const vm = toProvenanceVM(item({}), raw({ requests }))
      expect(vm.approvals[0].decision).toBe(expected)
    }
  })

  it('infers "request" from a governance accessRequest history event (no request row)', () => {
    const events: HistoricalEvent[] = [
      {
        certificationId: 'c',
        certificationName: 'n',
        accessItem: { displayName: 'Admin Console' },
        accessItemType: 'entitlement',
        attributeChanges: [],
        accessRequest: { requesterName: 'Dana Requester' },
        governanceEvent: { type: 'accessRequest' },
        dateTime: '2024-01-01T00:00:00Z',
      } as unknown as HistoricalEvent,
    ]
    const vm = toProvenanceVM(item({}), raw({ events }))
    expect(vm.grantMechanism).toBe('request')
    expect(vm.request?.requestedBy).toBe('Dana Requester')
    expect(vm.approvals).toEqual([])
    expect(vm.grantedOn).toBe('2024-01-01T00:00:00Z')
  })

  it('infers "direct" when a history event has an EMPTY accessRequest object', () => {
    const events: HistoricalEvent[] = [
      {
        certificationId: 'c',
        certificationName: 'n',
        accessItem: { displayName: 'Admin Console' },
        accessItemType: 'entitlement',
        attributeChanges: [],
        // Object present but no requesterId/requesterName -> NOT a request.
        accessRequest: {},
        governanceEvent: { type: 'certification' },
        dateTime: '2024-02-02T00:00:00Z',
      } as unknown as HistoricalEvent,
    ]
    const vm = toProvenanceVM(item({}), raw({ events }))
    expect(vm.grantMechanism).toBe('direct')
    expect(vm.mechanismLabel).toBe('Assigned directly')
    expect(vm.grantedOn).toBe('2024-02-02T00:00:00Z')
  })

  it('infers "direct" when governanceEvent is null and no request signal', () => {
    const events: HistoricalEvent[] = [
      {
        certificationId: 'c',
        certificationName: 'n',
        accessItem: { displayName: 'Admin Console' },
        accessItemType: 'entitlement',
        attributeChanges: [],
        accessRequest: {},
        governanceEvent: null,
        dateTime: '2024-02-05T00:00:00Z',
      } as unknown as HistoricalEvent,
    ]
    const vm = toProvenanceVM(item({}), raw({ events }))
    expect(vm.grantMechanism).toBe('direct')
  })

  it('never emits "role" from history for a non-role item', () => {
    const events: HistoricalEvent[] = [
      {
        certificationId: 'c',
        certificationName: 'n',
        accessItem: { displayName: 'Admin Console' },
        accessItemType: 'role',
        attributeChanges: [],
        accessRequest: {},
        governanceEvent: null,
      } as unknown as HistoricalEvent,
    ]
    const vm = toProvenanceVM(item({ accessKind: 'entitlement' }), raw({ events }))
    expect(vm.grantMechanism).not.toBe('role')
  })

  it('yields honest "unknown" with no data', () => {
    const vm = toProvenanceVM(item({}), raw({ events: [] }))
    expect(vm.grantMechanism).toBe('unknown')
    expect(vm.mechanismLabel).toBe('Granted outside an access request')
    expect(vm.historyUnavailable).toBe(false)
  })

  it('sets historyUnavailable when history could not be reached', () => {
    const vm = toProvenanceVM(item({}), raw({ events: null }))
    expect(vm.grantMechanism).toBe('unknown')
    expect(vm.historyUnavailable).toBe(true)
  })
})

describe('createProvenanceResolver', () => {
  function okRes<T>(data: T) {
    return Promise.resolve({ data })
  }

  it('fetches each identity once and reuses the cached bundle', async () => {
    const listAccessRequestStatusV1 = vi.fn().mockReturnValue(okRes([]))
    const getHistoricalIdentityEventsV1 = vi.fn().mockReturnValue(okRes([]))
    const resolver = createProvenanceResolver(
      { listAccessRequestStatusV1 } as never,
      { getHistoricalIdentityEventsV1 } as never,
    )

    const [a, b] = await Promise.all([
      resolver.forIdentity('id-1'),
      resolver.forIdentity('id-1'),
    ])
    const c = await resolver.forIdentity('id-1')

    expect(a).toBe(b)
    expect(c).toBe(a)
    expect(listAccessRequestStatusV1).toHaveBeenCalledTimes(1)
    expect(getHistoricalIdentityEventsV1).toHaveBeenCalledTimes(1)
  })

  it('passes the experimental flag on the history call', async () => {
    const getHistoricalIdentityEventsV1 = vi.fn().mockReturnValue(okRes([]))
    const resolver = createProvenanceResolver(
      { listAccessRequestStatusV1: vi.fn().mockReturnValue(okRes([])) } as never,
      { getHistoricalIdentityEventsV1 } as never,
    )

    await resolver.forIdentity('id-1')

    expect(getHistoricalIdentityEventsV1).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'id-1', xSailPointExperimental: 'true' }),
    )
  })

  it('degrades history 400/403 to null without sinking the request path', async () => {
    const resolver = createProvenanceResolver(
      {
        listAccessRequestStatusV1: vi
          .fn()
          .mockReturnValue(okRes([{ name: 'Admin Console' }])),
      } as never,
      {
        getHistoricalIdentityEventsV1: vi
          .fn()
          .mockRejectedValue({ response: { status: 403 } }),
      } as never,
    )

    const bundle = await resolver.forIdentity('id-1')
    expect(bundle.events).toBeNull()
    expect(bundle.requests).toHaveLength(1)
    expect(bundle.requestsFailedHard).toBe(false)
  })

  it('treats a 401/403 request failure as a soft degrade (not hard)', async () => {
    const resolver = createProvenanceResolver(
      {
        listAccessRequestStatusV1: vi
          .fn()
          .mockRejectedValue({ response: { status: 403 } }),
      } as never,
      { getHistoricalIdentityEventsV1: vi.fn().mockReturnValue(okRes([])) } as never,
    )

    const bundle = await resolver.forIdentity('id-1')
    expect(bundle.requests).toEqual([])
    expect(bundle.requestsFailedHard).toBe(false)
  })

  it('flags a 429/5xx/network request failure as hard', async () => {
    const resolver = createProvenanceResolver(
      {
        listAccessRequestStatusV1: vi
          .fn()
          .mockRejectedValue({ response: { status: 503 } }),
      } as never,
      { getHistoricalIdentityEventsV1: vi.fn().mockReturnValue(okRes([])) } as never,
    )

    const bundle = await resolver.forIdentity('id-1')
    expect(bundle.requestsFailedHard).toBe(true)
  })
})
