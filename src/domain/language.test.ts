import { describe, expect, it } from 'vitest'
import {
  CANNED_COMMENTS,
  DECISION_LABEL,
  DECISION_MEANING,
  deadlineText,
} from './language'

describe('canned comments', () => {
  it('offers distinct, non-empty suggestions for each decision', () => {
    expect(CANNED_COMMENTS.allow.length).toBeGreaterThan(0)
    expect(CANNED_COMMENTS.remove.length).toBeGreaterThan(0)
    // Keep/remove suggestions should not overlap.
    const overlap = CANNED_COMMENTS.allow.filter((c) =>
      CANNED_COMMENTS.remove.includes(c),
    )
    expect(overlap).toHaveLength(0)
  })

  it('offers reassign suggestions in plain, non-technical language', () => {
    expect(CANNED_COMMENTS.reassign.length).toBeGreaterThan(0)
    for (const comment of CANNED_COMMENTS.reassign) {
      expect(comment.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('decision labels', () => {
  it('uses plain business language, not APPROVE/REVOKE', () => {
    expect(DECISION_LABEL.allow).toMatch(/keep/i)
    expect(DECISION_LABEL.remove).toMatch(/remove/i)
    expect(DECISION_LABEL.reassign).toBe('Reassign')
  })

  it('explains what reassigning does', () => {
    expect(DECISION_MEANING.reassign).toMatch(/someone else/i)
  })
})

describe('deadlineText', () => {
  it('describes future, due-today, overdue, and no-deadline', () => {
    expect(deadlineText(5)).toBe('5 days left')
    expect(deadlineText(1)).toBe('1 day left')
    expect(deadlineText(0)).toBe('Due today')
    expect(deadlineText(-1)).toBe('1 day overdue')
    expect(deadlineText(-3)).toBe('3 days overdue')
    expect(deadlineText(null)).toBe('No deadline set')
  })
})
