import { describe, expect, it } from 'vitest'
import type { ReviewItemVM } from '../sailpoint/types'
import {
  countByPriority,
  hasNoRiskSignals,
  prioritize,
  scoreItem,
} from './priority'

/** Builds a review item with sensible defaults, overridable per test. */
function item(overrides: Partial<ReviewItemVM> = {}): ReviewItemVM {
  return {
    id: 'r',
    completed: false,
    decision: null,
    reassigned: false,
    comments: null,
    personName: 'Zed',
    accessName: 'Something',
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

describe('scoreItem', () => {
  it('scores a high-signal item well above a plain one', () => {
    const risky = scoreItem(
      item({
        aiRecommendation: 'DENY',
        isPrivileged: true,
        isNewAccess: true,
        dataImpact: 'high',
      }),
    )
    const plain = scoreItem(item())

    expect(risky.score).toBeGreaterThan(plain.score)
    expect(risky.level).toBe('high')
    expect(plain.score).toBe(0)
    expect(plain.level).toBe('none')
  })

  it('lists reasons highest-impact first', () => {
    const result = scoreItem(
      item({ isCloudGoverned: true, aiRecommendation: 'REVOKE', isNewAccess: true }),
    )
    expect(result.reasons[0].key).toBe('ai')
    expect(result.reasons.map((r) => r.key)).toContain('cloud')
  })

  it('caps the score at 100', () => {
    const result = scoreItem(
      item({
        aiRecommendation: 'DENY',
        dataImpact: 'high',
        isPrivileged: true,
        isNewAccess: true,
        usageDays: 0,
        isCloudGoverned: true,
      }),
    )
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('only counts "rarely used" when usage data shows zero', () => {
    expect(scoreItem(item({ usageDays: null })).reasons).toHaveLength(0)
    expect(
      scoreItem(item({ usageDays: 0 })).reasons.some((r) => r.key === 'unused'),
    ).toBe(true)
    expect(
      scoreItem(item({ usageDays: 10 })).reasons.some((r) => r.key === 'unused'),
    ).toBe(false)
  })
})

describe('prioritize', () => {
  it('puts a privileged + AI-flagged + new item ahead of a plain item', () => {
    const plain = item({ id: 'plain', personName: 'Aaron' })
    const risky = item({
      id: 'risky',
      personName: 'Zoe',
      aiRecommendation: 'DENY',
      isPrivileged: true,
      isNewAccess: true,
    })

    const ordered = prioritize([plain, risky])

    expect(ordered[0].item.id).toBe('risky')
    expect(ordered[1].item.id).toBe('plain')
  })

  it('falls back to a stable alphabetical order when no signals exist', () => {
    const ordered = prioritize([
      item({ id: '1', personName: 'Charlie', accessName: 'B' }),
      item({ id: '2', personName: 'Alice', accessName: 'Z' }),
      item({ id: '3', personName: 'Alice', accessName: 'A' }),
    ])

    expect(ordered.map((o) => o.item.id)).toEqual(['3', '2', '1'])
    expect(hasNoRiskSignals(ordered)).toBe(true)
  })

  it('sinks already-decided items to the bottom', () => {
    const done = item({ id: 'done', completed: true, aiRecommendation: 'DENY' })
    const todo = item({ id: 'todo' })

    const ordered = prioritize([done, todo])

    expect(ordered[0].item.id).toBe('todo')
    expect(ordered[1].item.id).toBe('done')
  })

  it('sinks reassigned items like decided ones', () => {
    const reassigned = item({
      id: 'reassigned',
      reassigned: true,
      aiRecommendation: 'DENY',
    })
    const todo = item({ id: 'todo' })

    const ordered = prioritize([reassigned, todo])

    expect(ordered[0].item.id).toBe('todo')
    expect(ordered[1].item.id).toBe('reassigned')
  })
})

describe('countByPriority', () => {
  it('excludes reassigned items from the outstanding tally', () => {
    const prioritized = prioritize([
      item({ id: '1', aiRecommendation: 'DENY', isPrivileged: true }),
      item({ id: '2', reassigned: true, aiRecommendation: 'DENY', isPrivileged: true }),
    ])

    const counts = countByPriority(prioritized)

    // Only the outstanding high-signal item is counted; the reassigned one is
    // resolved and drops out.
    expect(counts.high).toBe(1)
  })
})
