import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'

describe('state components', () => {
  it('LoadingState announces progress to assistive tech', () => {
    render(<LoadingState message="Loading reviews…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading reviews…')
  })

  it('EmptyState reads as reassuring, not broken', () => {
    render(<EmptyState title="All caught up" message="Nothing to review." />)
    expect(screen.getByRole('status')).toHaveTextContent('All caught up')
    expect(screen.getByText('Nothing to review.')).toBeInTheDocument()
  })

  it('ErrorState shows the friendly message and retries', async () => {
    const onRetry = vi.fn()
    render(<ErrorState message="We couldn't reach SailPoint." onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toHaveTextContent("couldn't reach SailPoint")
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
