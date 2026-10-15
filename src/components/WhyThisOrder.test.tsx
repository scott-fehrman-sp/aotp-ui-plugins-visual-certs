import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { WhyThisOrder } from './WhyThisOrder'

describe('WhyThisOrder', () => {
  it('is collapsed by default and expands to explain the ordering factors', async () => {
    render(<WhyThisOrder noRiskSignals={false} />)

    const toggle = screen.getByRole('button', { name: /why this order/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/flagged by sailpoint ai/i)).toBeInTheDocument()
    expect(screen.getByText(/elevated \/ admin access/i)).toBeInTheDocument()
  })

  it('explains an alphabetical fallback when there are no risk signals', async () => {
    render(<WhyThisOrder noRiskSignals={true} />)
    await userEvent.click(screen.getByRole('button', { name: /why this order/i }))
    expect(screen.getByText(/alphabetical order/i)).toBeInTheDocument()
  })
})
