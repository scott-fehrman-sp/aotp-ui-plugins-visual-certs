import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { statusGraph, type StatusRow } from '../test/reviewStatusFixture'
import { AccessGraphCanvas } from './AccessGraphCanvas'

// Separate file so mocking useReactFlow's zoom does not touch the other canvas
// tests. Everything else in @xyflow/react stays real.
const zoomInSpy = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
const zoomOutSpy = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
const fitViewSpy = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    useReactFlow: () => ({
      ...actual.useReactFlow(),
      zoomIn: zoomInSpy,
      zoomOut: zoomOutSpy,
      fitView: fitViewSpy,
    }),
  }
})

function row(overrides: Partial<StatusRow>): StatusRow {
  return {
    id: 'r',
    userId: 'u1',
    user: 'User One',
    role: '',
    roleId: null,
    accessProfile: '',
    accessProfileId: null,
    entitlement: '',
    entitlementId: null,
    source: '',
    sourceId: null,
    unresolved: false,
    ...overrides,
  }
}

/**
 * User One holds Role A (needs review, with nested lineage), Profile B, and
 * Login directly, plus a completed Admin entitlement that stays hidden until
 * completed items are shown.
 */
function graph(): ReturnType<typeof statusGraph> {
  return statusGraph([
    row({
      id: '1',
      role: 'Role A',
      roleId: 'role-a',
      accessProfile: 'Nested AP',
      accessProfileId: 'ap-nested',
      entitlement: 'Nested Ent',
      entitlementId: 'e-nested',
      entitlementAttribute: 'memberOf',
      source: 'Directory',
      sourceId: 's1',
      reviewStatus: 'needsReview',
      accessItemKind: 'role',
      accessItemId: 'role-a',
      accessItemName: 'Role A',
    }),
    row({
      id: '2',
      accessProfile: 'Profile B',
      accessProfileId: 'ap-b',
      entitlement: 'Ent B',
      entitlementId: 'e-b',
      source: 'ERP',
      sourceId: 's2',
      reviewStatus: 'needsReview',
      accessItemKind: 'accessProfile',
      accessItemId: 'ap-b',
      accessItemName: 'Profile B',
    }),
    row({
      id: '3',
      entitlement: 'Login',
      entitlementId: 'e-login',
      source: 'Phone',
      sourceId: 's3',
      reviewStatus: 'needsReview',
      accessItemKind: 'entitlement',
      accessItemId: 'e-login',
      accessItemName: 'Login',
    }),
    row({
      id: '4',
      entitlement: 'Admin',
      entitlementId: 'e-admin',
      source: 'Phone',
      sourceId: 's3',
      reviewStatus: 'approved',
      accessItemKind: 'entitlement',
      accessItemId: 'e-admin',
      accessItemName: 'Admin',
    }),
  ])
}

const pane = () => {
  const el = document.querySelector('.react-flow__pane')
  if (!el) throw new Error('pane missing')
  return el
}

function openCanvasMenu(x = 80, y = 60) {
  fireEvent.contextMenu(pane(), { clientX: x, clientY: y })
  return screen.getByRole('menu', { name: 'Canvas menu' })
}

function toolbarButtons() {
  return within(screen.getByRole('toolbar', { name: 'Graph controls' })).getAllByRole('button')
}

/** The canvas menu lists the live toolbar, then the zoom actions. */
function expectCanvasMenuMatchesToolbar() {
  const menu = screen.getByRole('menu', { name: 'Canvas menu' })
  const buttons = toolbarButtons()
  const items = within(menu).getAllByRole('menuitem')
  buttons.forEach((button, index) => {
    expect(items[index].textContent).toBe(button.getAttribute('aria-label'))
    expect(items[index].querySelector('svg')).toHaveAttribute(
      'data-icon',
      button.querySelector('svg')!.getAttribute('data-icon'),
    )
    expect(items[index].firstElementChild?.tagName).toBe('svg')
  })
  expect(items.slice(buttons.length).map((item) => item.textContent)).toEqual([
    'Zoom in',
    'Zoom out',
    'Fit',
  ])
  expect(items.at(-3)!.querySelector('svg')).toHaveAttribute('data-icon', 'zoomIn')
  expect(items.at(-2)!.querySelector('svg')).toHaveAttribute('data-icon', 'zoomOut')
  expect(items.at(-1)!.querySelector('svg')).toHaveAttribute('data-icon', 'fit')
  const roles = Array.from(menu.children).map((el) => el.getAttribute('role'))
  expect(roles.indexOf('separator')).toBe(buttons.length)
  expect(roles.slice(buttons.length)).toEqual(['separator', 'menuitem', 'menuitem', 'menuitem'])
  return menu
}

const drillIn = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))

describe('AccessGraphCanvas context menu', () => {
  beforeEach(() => {
    zoomInSpy.mockClear()
    zoomOutSpy.mockClear()
    fitViewSpy.mockClear()
  })

  describe('user matrix', () => {
    it('opens the control-panel actions, a divider, and zoom on the background', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      const menu = openCanvasMenu(40, 50)
      expectCanvasMenuMatchesToolbar()
      expect(menu.style.left).toBe('40px')
      expect(menu.style.top).toBe('50px')
      expect(toolbarButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
        'Show minimap',
      ])
    })

    it('keeps the menu inside the viewport', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      const menu = openCanvasMenu(window.innerWidth + 400, window.innerHeight + 400)
      const left = parseFloat(menu.style.left)
      const top = parseFloat(menu.style.top)
      expect(left).toBeGreaterThanOrEqual(8)
      expect(top).toBeGreaterThanOrEqual(8)
      expect(left).toBeLessThanOrEqual(window.innerWidth - 8)
      expect(top).toBeLessThanOrEqual(window.innerHeight - 8)
    })

    it('runs the toolbar action from the menu and closes', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      const menu = openCanvasMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Show minimap' }))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Hide minimap' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      openCanvasMenu()
      expectCanvasMenuMatchesToolbar()
    })

    it('zooms in, out, and fits from the menu', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      fitViewSpy.mockClear()
      for (const [label, spy] of [
        ['Zoom in', zoomInSpy],
        ['Zoom out', zoomOutSpy],
        ['Fit', fitViewSpy],
      ] as const) {
        const menu = openCanvasMenu()
        fireEvent.click(within(menu).getByRole('menuitem', { name: label }))
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy).toHaveBeenCalledWith({ duration: 0 })
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        spy.mockClear()
      }
    })

    it('does nothing on a user card', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      const card = screen.getByRole('button', { name: 'Show access for User One' })
      expect(fireEvent.contextMenu(card, { clientX: 12, clientY: 12 })).toBe(false)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      // Still on the user grid: the card was not drilled into.
      expect(screen.getByRole('button', { name: 'Show access for User One' })).toBeInTheDocument()
    })

    it('closes on click outside, Escape, and when leaving the grid', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      openCanvasMenu()
      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()

      const menu = openCanvasMenu()
      fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Show minimap' }), {
        key: 'Escape',
      })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()

      openCanvasMenu()
      drillIn()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('moves focus with the arrow keys and skips the divider', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      const menu = openCanvasMenu()
      const minimap = within(menu).getByRole('menuitem', { name: 'Show minimap' })
      expect(minimap).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'ArrowDown' })
      expect(within(menu).getByRole('menuitem', { name: 'Zoom in' })).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'End' })
      expect(within(menu).getByRole('menuitem', { name: 'Fit' })).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'Home' })
      expect(minimap).toHaveFocus()
    })
  })

  describe('access graph', () => {
    it('opens the drill-down control panel, a divider, and zoom on the background', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      drillIn()
      openCanvasMenu()
      expectCanvasMenuMatchesToolbar()
      expect(toolbarButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
        'Layout: horizontal',
        'Show reference nodes and links',
        'Show completed items (1 hidden)',
        'Show legend',
        'Show minimap',
        'Show details panel',
      ])
    })

    it('runs a drill-down toolbar action from the menu', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      drillIn()
      const menu = openCanvasMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Layout: horizontal' }))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Layout: vertical' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    it('Escape closes the menu and stays in the drill-down', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      drillIn()
      const onWindowKey = vi.fn()
      window.addEventListener('keydown', onWindowKey)
      try {
        const menu = openCanvasMenu()
        fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Layout: horizontal' }), {
          key: 'Escape',
        })
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Layout: horizontal' })).toBeInTheDocument()
        expect(onWindowKey).not.toHaveBeenCalled()
      } finally {
        window.removeEventListener('keydown', onWindowKey)
      }
    })

    it('offers disabled Approve, Revoke, and Reassign on a role, access profile, and entitlement', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      drillIn()
      for (const name of ['Role: Role A', 'Access profile: Profile B', 'Entitlement: Login']) {
        const card = screen.getByRole('button', { name })
        expect(fireEvent.contextMenu(card, { clientX: 30, clientY: 40 })).toBe(false)
        const menu = screen.getByRole('menu', { name: 'Review actions' })
        const items = within(menu).getAllByRole('menuitem')
        expect(items.map((item) => item.textContent)).toEqual(['Approve', 'Revoke', 'Reassign'])
        expect(items.map((item) => item.querySelector('svg')?.getAttribute('data-review-status'))).toEqual([
          'approved',
          'revoked',
          'reassigned',
        ])
        for (const item of items) {
          expect(item).toBeDisabled()
          expect(item.firstElementChild?.tagName).toBe('svg')
        }
        expect(within(menu).queryByRole('separator')).not.toBeInTheDocument()
        expect(card).toHaveAttribute('aria-pressed', 'false')
        fireEvent.click(items[0])
        expect(screen.getByRole('menu', { name: 'Review actions' })).toBeInTheDocument()
        fireEvent.pointerDown(document.body)
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      }
    })

    it('offers the same disabled actions on a completed access item once it is shown', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      drillIn()
      fireEvent.click(screen.getByRole('button', { name: 'Show completed items (1 hidden)' }))
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Entitlement: Admin' }))
      const items = within(screen.getByRole('menu', { name: 'Review actions' })).getAllByRole(
        'menuitem',
      )
      expect(items.map((item) => item.textContent)).toEqual(['Approve', 'Revoke', 'Reassign'])
      expect(items.every((item) => item.hasAttribute('disabled'))).toBe(true)
    })

    it('does nothing on a reference-only node or the pinned user', () => {
      render(<AccessGraphCanvas graph={graph()} />)
      drillIn()
      fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))
      for (const name of [
        'Access profile: Nested AP',
        'Entitlement: Nested Ent',
        'Attribute: memberOf',
        'Source: Directory',
      ]) {
        const card = screen.getByRole('button', { name })
        expect(card.className).toContain('vc-graph-card-reference')
        expect(fireEvent.contextMenu(card)).toBe(false)
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      }
      const pinned = screen.getByLabelText('User: User One')
      expect(fireEvent.contextMenu(pinned)).toBe(false)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Layout: horizontal' })).toBeInTheDocument()
    })
  })
})
