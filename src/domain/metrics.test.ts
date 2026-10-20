import { describe, expect, it } from 'vitest'
import type { CampaignVM, ReviewItemVM } from '../sailpoint/types'
import { computeMetrics, daysUntil, isItemReviewed, reviewStatusOf } from './metrics'

function campaign(overrides: Partial<CampaignVM> = {}): CampaignVM {
  return {
    id: 'c1',
    name: 'Review',
    description: null,
    phase: 'inProgress',
    decisionsMade: 0,
    decisionsTotal: 0,
    due: null,
    signed: null,
    commentRequirement: 'none',
    ...overrides,
  }
}

function reviewItem(overrides: Partial<ReviewItemVM> = {}): ReviewItemVM {
  return {
    id: 'r',
    identityId: 'id-r',
    completed: false,
    decision: null,
    reassigned: false,
    comments: null,
    personName: 'P',
    accessName: 'A',
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

describe('reviewStatusOf', () => {
  it('returns reassigned for a reassigned item, even when also decided', () => {
    expect(reviewStatusOf(reviewItem({ reassigned: true }))).toBe('reassigned')
    expect(
      reviewStatusOf(
        reviewItem({ reassigned: true, completed: true, decision: 'APPROVE' }),
      ),
    ).toBe('reassigned')
  })

  it('returns approved for a kept (APPROVE) item', () => {
    expect(reviewStatusOf(reviewItem({ completed: true, decision: 'APPROVE' }))).toBe(
      'approved',
    )
  })

  it('returns revoked for a removed (REVOKE) item', () => {
    expect(reviewStatusOf(reviewItem({ completed: true, decision: 'REVOKE' }))).toBe(
      'revoked',
    )
  })

  it('maps a bare completed-without-decision item to approved (defensive fallback)', () => {
    expect(reviewStatusOf(reviewItem({ completed: true }))).toBe('approved')
  })

  it('returns needsReview for an undecided, non-reassigned item', () => {
    expect(reviewStatusOf(reviewItem())).toBe('needsReview')
  })

  it('isItemReviewed is true for approved, revoked and reassigned, false for needsReview', () => {
    expect(isItemReviewed(reviewItem({ completed: true, decision: 'APPROVE' }))).toBe(
      true,
    )
    expect(isItemReviewed(reviewItem({ completed: true, decision: 'REVOKE' }))).toBe(
      true,
    )
    expect(isItemReviewed(reviewItem({ reassigned: true }))).toBe(true)
    expect(isItemReviewed(reviewItem())).toBe(false)
  })
})

describe('daysUntil', () => {
  const now = new Date('2026-01-10T00:00:00Z')

  it('returns whole days until a future deadline', () => {
    expect(daysUntil('2026-01-15T00:00:00Z', now)).toBe(5)
  })

  it('returns a negative number when overdue', () => {
    expect(daysUntil('2026-01-08T00:00:00Z', now)).toBe(-2)
  })

  it('returns null when there is no deadline', () => {
    expect(daysUntil(null, now)).toBeNull()
  })

  it('returns null for an unparseable date', () => {
    expect(daysUntil('not-a-date', now)).toBeNull()
  })
})

describe('computeMetrics', () => {
  const now = new Date('2026-01-10T00:00:00Z')

  it('derives approved/revoked and progress from live items', () => {
    const items = [
      reviewItem({ id: '1', completed: true, decision: 'APPROVE' }),
      reviewItem({ id: '2', completed: true, decision: 'REVOKE' }),
      reviewItem({ id: '3' }),
      reviewItem({ id: '4' }),
    ]

    const m = computeMetrics(campaign({ due: '2026-01-20T00:00:00Z' }), items, now)

    expect(m).toMatchObject({
      total: 4,
      reviewed: 2,
      remaining: 2,
      approved: 1,
      revoked: 1,
      reassigned: 0,
      percentComplete: 50,
      daysRemaining: 10,
      isOverdue: false,
      isComplete: false,
    })
  })

  it('counts a reassigned item as reviewed but neither approved nor revoked', () => {
    const items = [
      reviewItem({ id: '1', completed: true, decision: 'APPROVE' }),
      reviewItem({ id: '2', reassigned: true }),
      reviewItem({ id: '3' }),
    ]

    const m = computeMetrics(campaign(), items, now)

    expect(m).toMatchObject({
      total: 3,
      reviewed: 2,
      remaining: 1,
      approved: 1,
      revoked: 0,
      reassigned: 1,
    })
    // Reassign advances progress just like keep/remove.
    expect(m.percentComplete).toBe(67)
  })

  it('produces a four-way split for a mixed campaign', () => {
    const items = [
      reviewItem({ id: '1', completed: true, decision: 'APPROVE' }),
      reviewItem({ id: '2', completed: true, decision: 'APPROVE' }),
      reviewItem({ id: '3', completed: true, decision: 'REVOKE' }),
      reviewItem({ id: '4', reassigned: true }),
      reviewItem({ id: '5' }),
    ]

    const m = computeMetrics(campaign(), items, now)

    expect(m).toMatchObject({
      total: 5,
      reviewed: 4,
      remaining: 1,
      approved: 2,
      revoked: 1,
      reassigned: 1,
      percentComplete: 80,
    })
  })

  it('leaves reassigned at 0 in the campaign-count fallback', () => {
    const m = computeMetrics(
      campaign({ decisionsMade: 3, decisionsTotal: 12 }),
      null,
      now,
    )
    expect(m.reassigned).toBe(0)
  })

  it('falls back to campaign counts when items are not loaded', () => {
    const m = computeMetrics(
      campaign({ decisionsMade: 3, decisionsTotal: 12 }),
      null,
      now,
    )
    expect(m.total).toBe(12)
    expect(m.reviewed).toBe(3)
    expect(m.remaining).toBe(9)
    expect(m.percentComplete).toBe(25)
  })

  it('handles a campaign with zero items', () => {
    const m = computeMetrics(campaign(), [], now)
    expect(m.total).toBe(0)
    expect(m.percentComplete).toBe(0)
    expect(m.isComplete).toBe(false)
    expect(m.daysRemaining).toBeNull()
  })

  it('handles no deadline without breaking', () => {
    const m = computeMetrics(campaign({ due: null }), [reviewItem()], now)
    expect(m.daysRemaining).toBeNull()
    expect(m.isOverdue).toBe(false)
  })

  it('flags an overdue, fully reviewed campaign as complete', () => {
    const items = [reviewItem({ completed: true, decision: 'APPROVE' })]
    const m = computeMetrics(campaign({ due: '2026-01-01T00:00:00Z' }), items, now)
    expect(m.isComplete).toBe(true)
    expect(m.isOverdue).toBe(true)
  })
})
