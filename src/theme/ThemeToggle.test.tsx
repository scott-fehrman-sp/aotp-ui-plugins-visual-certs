import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from './ThemeProvider'
import { ThemeToggle } from './ThemeToggle'

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('ThemeToggle', () => {
  it('defaults to light (matchMedia is stubbed non-matching in tests)', () => {
    renderToggle()
    const button = screen.getByRole('button', { name: /switch to dark mode/i })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('toggles to dark on click and reflects it on <html> and in storage', async () => {
    const user = userEvent.setup()
    renderToggle()

    await user.click(screen.getByRole('button', { name: /switch to dark mode/i }))

    const button = screen.getByRole('button', { name: /switch to light mode/i })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('visual-certs-theme')).toBe('dark')
  })

  it('toggles back to light on a second click', async () => {
    const user = userEvent.setup()
    renderToggle()

    const toggle = () => screen.getByRole('button')
    await user.click(toggle())
    await user.click(toggle())

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('visual-certs-theme')).toBe('light')
  })

  it('restores an explicit stored choice on mount', () => {
    localStorage.setItem('visual-certs-theme', 'dark')
    renderToggle()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(
      screen.getByRole('button', { name: /switch to light mode/i }),
    ).toBeInTheDocument()
  })
})
