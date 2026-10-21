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
    showCompleted: true,
    onToggleCompleted: vi.fn(),
    hiddenCompletedCount: 0,
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
  it('renders a named toolbar with Layout, Reference, Completed, Minimap buttons in order', () => {
    setup()
    const toolbar = screen.getByRole('toolbar', { name: 'Graph controls' })
    const buttons = within(toolbar).getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Layout: vertical',
      'Hide reference nodes and links',
      'Hide completed items',
      'Hide minimap',
    ])
  })

  it('labels and presses each button from its state', () => {
    setup({
      rankdir: 'TB',
      showReference: false,
      showCompleted: false,
      hiddenCompletedCount: 12,
      showMinimap: false,
    })
    const layout = screen.getByRole('button', { name: 'Layout: horizontal' })
    expect(layout).toHaveAttribute('aria-pressed', 'false')
    const reference = screen.getByRole('button', { name: 'Show reference nodes and links' })
    expect(reference).toHaveAttribute('aria-pressed', 'false')
    const minimap = screen.getByRole('button', { name: 'Show minimap' })
    expect(minimap).toHaveAttribute('aria-pressed', 'false')
    const completed = screen.getByRole('button', { name: 'Show completed items (12 hidden)' })
    expect(completed).toHaveAttribute('aria-pressed', 'false')
    for (const b of [layout, reference, completed, minimap]) {
      expect(b).not.toHaveClass('vc-graph-control-active')
    }
  })

  it('marks Layout active/pressed for LR and the others active when shown', () => {
    setup()
    for (const name of [
      'Layout: vertical',
      'Hide reference nodes and links',
      'Hide completed items',
      'Hide minimap',
    ]) {
      const b = screen.getByRole('button', { name })
      expect(b).toHaveAttribute('aria-pressed', 'true')
      expect(b).toHaveClass('vc-graph-control-active')
    }
  })

  it('omits the hidden count when it is unknown', () => {
    setup({ showCompleted: false, hiddenCompletedCount: null })
    expect(screen.getByRole('button', { name: 'Show completed items' })).toBeInTheDocument()
  })

  it('shows a zero hidden count explicitly', () => {
    setup({ showCompleted: false, hiddenCompletedCount: 0 })
    expect(
      screen.getByRole('button', { name: 'Show completed items (0 hidden)' }),
    ).toBeInTheDocument()
  })

  it('uses the completed icon when completed items are shown', () => {
    setup()
    const shown = screen.getByRole('button', { name: 'Hide completed items' })
    expect(shown.querySelector('svg')).toHaveAttribute('data-icon', 'completed')
  })

  it('uses the struck completed icon when completed items are hidden', () => {
    setup({ showCompleted: false, hiddenCompletedCount: 3 })
    const hidden = screen.getByRole('button', { name: 'Show completed items (3 hidden)' })
    expect(hidden.querySelector('svg')).toHaveAttribute('data-icon', 'completedHidden')
  })

  it('disables Layout, Reference and Completed in the grid but keeps Minimap enabled', () => {
    const props = setup({ inDrilldown: false })
    const layout = screen.getByRole('button', { name: 'Layout (open a user to change)' })
    const reference = screen.getByRole('button', {
      name: 'Reference nodes and links (open a user to change)',
    })
    const completed = screen.getByRole('button', {
      name: 'Completed items (open a user to filter)',
    })
    const minimap = screen.getByRole('button', { name: 'Hide minimap' })
    expect(layout).toBeDisabled()
    expect(reference).toBeDisabled()
    expect(completed).toBeDisabled()
    expect(minimap).toBeEnabled()
    fireEvent.click(layout)
    fireEvent.click(reference)
    fireEvent.click(completed)
    fireEvent.click(minimap)
    expect(props.onToggleLayout).not.toHaveBeenCalled()
    expect(props.onToggleReference).not.toHaveBeenCalled()
    expect(props.onToggleCompleted).not.toHaveBeenCalled()
    expect(props.onToggleMinimap).toHaveBeenCalledTimes(1)
  })

  it('enables all buttons in drill-down and fires their handlers', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Layout: vertical' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide reference nodes and links' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide completed items' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide minimap' }))
    expect(props.onToggleLayout).toHaveBeenCalledTimes(1)
    expect(props.onToggleReference).toHaveBeenCalledTimes(1)
    expect(props.onToggleCompleted).toHaveBeenCalledTimes(1)
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

    it('shows the completed label with the hidden count on hover', () => {
      setup({ showCompleted: false, hiddenCompletedCount: 12 })
      const anchor = anchorOf(
        screen.getByRole('button', { name: 'Show completed items (12 hidden)' }),
      )
      stubRect(anchor)
      fireEvent.mouseEnter(anchor)
      expect(screen.getByRole('tooltip')).toHaveTextContent('Show completed items (12 hidden)')
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
