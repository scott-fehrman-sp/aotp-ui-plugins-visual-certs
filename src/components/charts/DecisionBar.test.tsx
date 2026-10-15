import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DecisionBar } from './DecisionBar'

describe('DecisionBar', () => {
  it('summarizes kept, removed, and reassigned for screen readers', () => {
    render(<DecisionBar approved={4} revoked={2} reassigned={3} />)
    // The visually-hidden summary is the chart's accessibility invariant and
    // must mirror all three outcomes.
    expect(
      screen.getByText(/4 kept, 2 removed, 3 reassigned\./i),
    ).toBeInTheDocument()
  })

  it('shows a zero reassigned count when nothing was handed off', () => {
    render(<DecisionBar approved={1} revoked={1} reassigned={0} />)
    expect(
      screen.getByText(/1 kept, 1 removed, 0 reassigned\./i),
    ).toBeInTheDocument()
  })
})
