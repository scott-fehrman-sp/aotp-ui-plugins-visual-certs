import { describe, expect, it } from 'vitest'
import { reviewKey } from '../domain/reviewOverlay'
import { statusGraph, type StatusRow } from '../test/reviewStatusFixture'
import {
  decisionAnnouncement,
  decisionTargetIds,
  reviewKeysForNodes,
} from './accessDecision'

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

describe('decisionTargetIds', () => {
  it('acts on every selected needs-review item when the click is one of them', () => {
    expect(decisionTargetIds('role:a', true, ['role:a', 'entitlement:b'])).toEqual([
      'role:a',
      'entitlement:b',
    ])
  })

  it('acts on a needs-review item that is not part of the selection', () => {
    expect(decisionTargetIds('entitlement:c', true, ['role:a'])).toEqual(['entitlement:c'])
  })

  it('does nothing for an item that does not need review', () => {
    expect(decisionTargetIds('entitlement:done', false, ['entitlement:done'])).toBeNull()
  })
})

describe('reviewKeysForNodes', () => {
  it('returns the first-level review keys for the chosen nodes, in edge order', () => {
    const graph = statusGraph([
      row({
        id: '1',
        role: 'Role A',
        roleId: 'role-a',
        reviewStatus: 'needsReview',
        accessItemKind: 'role',
        accessItemId: 'role-a',
        accessItemName: 'Role A',
      }),
      row({
        id: '2',
        entitlement: 'Login',
        entitlementId: 'e-login',
        reviewStatus: 'needsReview',
        accessItemKind: 'entitlement',
        accessItemId: 'e-login',
        accessItemName: 'Login',
      }),
      row({
        id: '3',
        entitlement: 'Admin',
        entitlementId: 'e-admin',
        reviewStatus: 'approved',
        accessItemKind: 'entitlement',
        accessItemId: 'e-admin',
        accessItemName: 'Admin',
      }),
    ])

    expect(reviewKeysForNodes(graph, 'user:u1', ['entitlement:e-login', 'role:role-a'])).toEqual([
      reviewKey('u1', 'role', 'role-a', 'Role A'),
      reviewKey('u1', 'entitlement', 'e-login', 'Login'),
    ])
    expect(reviewKeysForNodes(graph, 'user:u1', ['source:missing'])).toEqual([])
  })
})

describe('decisionAnnouncement', () => {
  it('names the action and the number of access items', () => {
    expect(decisionAnnouncement('approve', 1)).toBe('Approved 1 access item.')
    expect(decisionAnnouncement('revoke', 2)).toBe('Revoked 2 access items.')
    expect(decisionAnnouncement('reassign', 3)).toBe('Reassigned 3 access items.')
  })
})
