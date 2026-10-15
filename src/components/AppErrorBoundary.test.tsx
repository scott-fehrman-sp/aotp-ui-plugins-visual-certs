import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

function Boom(): never {
  throw new Error('boom')
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    // React logs caught errors; silence to keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a friendly recovery screen when a child throws', () => {
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/unexpected problem/i)
    // The raw error message is not shown to the user.
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()
  })

  it('renders children normally when there is no error', () => {
    render(
      <AppErrorBoundary>
        <p>All good</p>
      </AppErrorBoundary>,
    )
    expect(screen.getByText('All good')).toBeInTheDocument()
  })
})
