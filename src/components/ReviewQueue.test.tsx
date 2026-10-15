import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { prioritize } from '../domain/priority'
import type { ReviewItemVM } from '../sailpoint/types'
import { ReviewQueue } from './ReviewQueue'

function reviewItem(overrides: Partial<ReviewItemVM>): ReviewItemVM {
  return {
    id: 'r',
    completed: false,
    decision: null,
    reassigned: false,
    comments: null,
    personName: 'Person',
    accessName: 'Access',
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

describe('ReviewQueue', () => {
  it('leads with the highest-priority item marked "Review this first"', () => {
    const items = [
      reviewItem({ id: 'plain', personName: 'Aaron', accessName: 'Email' }),
      reviewItem({
        id: 'risky',
        personName: 'Zoe',
        accessName: 'Admin Console',
        aiRecommendation: 'DENY',
        isPrivileged: true,
      }),
    ]
    render(
      <ReviewQueue
        ordered={prioritize(items)}
        noRiskSignals={false}
        onDecide={vi.fn()}
      />,
    )

    const cards = screen.getAllByRole('listitem')
    // First card is the risky one and carries the badge.
    expect(within(cards[0]).getByText('Zoe')).toBeInTheDocument()
    expect(within(cards[0]).getByText('Review this first')).toBeInTheDocument()
    // Risky card shows plain-language reason chips.
    expect(within(cards[0]).getByText(/flagged by sailpoint ai/i)).toBeInTheDocument()
    expect(within(cards[0]).getByText(/elevated \/ admin access/i)).toBeInTheDocument()
  })

  it('calls onDecide with the item id and choice', async () => {
    const onDecide = vi.fn()
    const items = [reviewItem({ id: 'r1', personName: 'Sam' })]
    render(
      <ReviewQueue
        ordered={prioritize(items)}
        noRiskSignals={false}
        onDecide={onDecide}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /keep access/i }))
    expect(onDecide).toHaveBeenCalledWith('r1', 'allow')

    await userEvent.click(screen.getByRole('button', { name: /remove access/i }))
    expect(onDecide).toHaveBeenCalledWith('r1', 'remove')

    await userEvent.click(screen.getByRole('button', { name: /^reassign$/i }))
    expect(onDecide).toHaveBeenCalledWith('r1', 'reassign')
  })

  it('explains an alphabetical fallback when there are no risk signals', async () => {
    const items = [reviewItem({ id: 'r1', personName: 'Sam' })]
    render(
      <ReviewQueue
        ordered={prioritize(items)}
        noRiskSignals={true}
        onDecide={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /why this order/i }))
    expect(screen.getByText(/alphabetical order/i)).toBeInTheDocument()
  })
})
