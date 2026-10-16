import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { prioritize } from '../domain/priority'
import type { ReviewItemVM } from '../sailpoint/types'
import { DrillDownTable } from './DrillDownTable'

function reviewItem(overrides: Partial<ReviewItemVM>): ReviewItemVM {
  return {
    id: 'r',
    identityId: 'id-r',
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

describe('DrillDownTable', () => {
  it('renders rows with person, access, priority, and decision', () => {
    const items = [
      reviewItem({
        id: 'r1',
        personName: 'Jo Smith',
        accessName: 'Payroll',
        isPrivileged: true,
        aiRecommendation: 'DENY',
        completed: true,
        decision: 'REVOKE',
      }),
    ]
    render(<DrillDownTable ordered={prioritize(items)} />)

    const rows = screen.getAllByRole('row')
    // Header + one data row.
    expect(rows).toHaveLength(2)
    const dataRow = rows[1]
    expect(within(dataRow).getByText('Jo Smith')).toBeInTheDocument()
    expect(within(dataRow).getByText('Payroll')).toBeInTheDocument()
    expect(within(dataRow).getByText(/needs a close look/i)).toBeInTheDocument()
    expect(within(dataRow).getByText('Removed')).toBeInTheDocument()
  })

  it('shows a plain message when there is nothing to show', () => {
    render(<DrillDownTable ordered={[]} />)
    expect(screen.getByText(/nothing to show/i)).toBeInTheDocument()
  })
})
