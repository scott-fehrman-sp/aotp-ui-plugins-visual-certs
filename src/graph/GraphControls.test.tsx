import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GraphControls } from './GraphControls'

type Props = Parameters<typeof GraphControls>[0]

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    inDrilldown: true,
    rankdir: 'LR',
    onToggleLayout: vi.fn(),
    showReference: true,
    onToggleReference: vi.fn(),
    showMinimap: true,
    onToggleMinimap: vi.fn(),
    ...overrides,
  }
  render(<GraphControls {...props} />)
  return props
}

/**
 * jsdom never lays out, so the hint (correctly) refuses to open on a zero-size
 * box. Give THIS anchor a plausible rect. Scoped to one element, never
 * `Element.prototype`, so layout-sensitive chart tests are unaffected.
 */
function stubRect(el: HTMLElement): void {
  el.getBoundingClientRect = () =>
    ({
      x: 900,
      y: 100,
      top: 100,
      left: 900,
      right: 932,
      bottom: 132,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    }) as DOMRect
}

const anchorOf = (button: HTMLElement) =>
  button.closest<HTMLElement>('.vc-graph-hint-anchor')!

describe('GraphControls', () => {
  it('renders a named toolbar with Layout, Reference, Minimap buttons in order', () => {
    setup()
    const toolbar = screen.getByRole('toolbar', { name: 'Graph controls' })
    const buttons = within(toolbar).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Layout: vertical',
      'Hide reference nodes and links',
      'Hide minimap',
    ])
  })

  it('labels and presses each button from its state', () => {
    setup({ rankdir: 'TB', showReference: false, showMinimap: false })
    const layout = screen.getByRole('button', { name: 'Layout: horizontal' })
    expect(layout).toHaveAttribute('aria-pressed', 'false')
    const reference = screen.getByRole('button', { name: 'Show reference nodes and links' })
    expect(reference).toHaveAttribute('aria-pressed', 'false')
    const minimap = screen.getByRole('button', { name: 'Show minimap' })
    expect(minimap).toHaveAttribute('aria-pressed', 'false')
    for (const b of [layout, reference, minimap]) {
      expect(b).not.toHaveClass('vc-graph-control-active')
    }
  })

  it('marks Layout active/pressed for LR and the others active when shown', () => {
    setup()
    for (const name of ['Layout: vertical', 'Hide reference nodes and links', 'Hide minimap']) {
      const b = screen.getByRole('button', { name })
      expect(b).toHaveAttribute('aria-pressed', 'true')
      expect(b).toHaveClass('vc-graph-control-active')
    }
  })

  it('disables Layout and Reference in the grid but keeps Minimap enabled', () => {
    const props = setup({ inDrilldown: false })
    const layout = screen.getByRole('button', { name: 'Layout (open a user to change)' })
    const reference = screen.getByRole('button', {
      name: 'Reference nodes and links (open a user to change)',
    })
    const minimap = screen.getByRole('button', { name: 'Hide minimap' })
    expect(layout).toBeDisabled()
    expect(reference).toBeDisabled()
    expect(minimap).toBeEnabled()
    fireEvent.click(layout)
    fireEvent.click(reference)
    fireEvent.click(minimap)
    expect(props.onToggleLayout).not.toHaveBeenCalled()
    expect(props.onToggleReference).not.toHaveBeenCalled()
    expect(props.onToggleMinimap).toHaveBeenCalledTimes(1)
  })

  it('enables all buttons in drill-down and fires their handlers', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Layout: vertical' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide reference nodes and links' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide minimap' }))
    expect(props.onToggleLayout).toHaveBeenCalledTimes(1)
    expect(props.onToggleReference).toHaveBeenCalledTimes(1)
    expect(props.onToggleMinimap).toHaveBeenCalledTimes(1)
  })

  describe('tooltip', () => {
    it('opens on hover to the left of the anchor and closes on leave', () => {
      setup()
      const button = screen.getByRole('button', { name: 'Hide minimap' })
      const anchor = anchorOf(button)
      stubRect(anchor)
      fireEvent.mouseEnter(anchor)
      const tip = screen.getByRole('tooltip')
      expect(tip).toHaveTextContent('Hide minimap')
      expect(button).toHaveAttribute('aria-describedby', tip.id)
      expect(tip.style.left).toBe('900px')
      expect(tip.style.top).toBe('116px')
      expect(tip).toHaveClass('vc-graph-hint-left')
      fireEvent.mouseLeave(anchor)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      expect(button).not.toHaveAttribute('aria-describedby')
    })

    it('opens on focus and closes on blur', () => {
      setup()
      const button = screen.getByRole('button', { name: 'Layout: vertical' })
      stubRect(anchorOf(button))
      fireEvent.focus(button)
      expect(screen.getByRole('tooltip')).toHaveTextContent('Layout: vertical')
      fireEvent.blur(button)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    it('does not open on a zero-size (unlaid-out) anchor', () => {
      setup()
      fireEvent.mouseEnter(anchorOf(screen.getByRole('button', { name: 'Hide minimap' })))
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    it('Escape closes an open tooltip without reaching window listeners', () => {
      setup()
      const onWindowKey = vi.fn()
      window.addEventListener('keydown', onWindowKey)
      try {
        const button = screen.getByRole('button', { name: 'Hide minimap' })
        stubRect(anchorOf(button))
        fireEvent.focus(button)
        expect(screen.getByRole('tooltip')).toBeInTheDocument()

        fireEvent.keyDown(button, { key: 'Escape' })
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
        expect(onWindowKey).not.toHaveBeenCalled()

        // With the tooltip closed, Escape passes through to the window.
        fireEvent.keyDown(button, { key: 'Escape' })
        expect(onWindowKey).toHaveBeenCalledTimes(1)
      } finally {
        window.removeEventListener('keydown', onWindowKey)
      }
    })

    it('shows a tooltip on a disabled button anchor in the grid', () => {
      setup({ inDrilldown: false })
      const button = screen.getByRole('button', { name: 'Layout (open a user to change)' })
      const anchor = anchorOf(button)
      stubRect(anchor)
      fireEvent.mouseEnter(anchor)
      expect(screen.getByRole('tooltip')).toHaveTextContent('Layout (open a user to change)')
    })
  })
})
