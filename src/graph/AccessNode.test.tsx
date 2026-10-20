import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AccessReviewStatus } from '../sailpoint/types'
import { StatusIcon } from './AccessNode'

const STATUSES: AccessReviewStatus[] = ['needsReview', 'approved', 'revoked', 'reassigned']

describe('StatusIcon', () => {
  it('renders a distinct shape and accessible name for every status', () => {
    const shapes = new Set<string>()
    const names = new Set<string>()
    for (const status of STATUSES) {
      const { container, unmount } = render(<StatusIcon status={status} />)
      const icon = screen.getByRole('img')
      expect(icon).toHaveAttribute('data-review-status', status)
      names.add(icon.getAttribute('aria-label') ?? '')
      shapes.add(container.querySelector('svg')!.innerHTML.replace(/<title>.*<\/title>/, ''))
      unmount()
    }
    expect(names.size).toBe(STATUSES.length)
    expect(shapes.size).toBe(STATUSES.length)
    expect(names.has('')).toBe(false)
  })
})
