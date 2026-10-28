import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TitleBackLink } from './CertApp'

afterEach(() => {
  document.getElementById('vc-title-nav')?.remove()
})

describe('TitleBackLink', () => {
  it('places "Back to all reviews" in the title slot, to the right of the title', () => {
    const titleNav = document.createElement('div')
    titleNav.id = 'vc-title-nav'
    document.body.appendChild(titleNav)
    const onClick = vi.fn()

    render(
      <TitleBackLink slot={titleNav} onClick={onClick}>
        ← All Reviews
      </TitleBackLink>,
    )

    const link = screen.getByRole('button', { name: '← All Reviews' })
    expect(titleNav).toContainElement(link)
    fireEvent.click(link)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('stays in the page when the app shell has no title slot', () => {
    const { container } = render(
      <TitleBackLink slot={null} onClick={vi.fn()}>
        ← All Reviews
      </TitleBackLink>,
    )
    expect(container).toContainElement(
      screen.getByRole('button', { name: '← All Reviews' }),
    )
  })
})
