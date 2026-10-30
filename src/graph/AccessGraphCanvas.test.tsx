import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import { buildFixtureGraph, statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { AccessGraphCanvas } from './AccessGraphCanvas'

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

/** Two users, each with a distinct access path, for mode-switch assertions. */
function twoUsers(): AccessMatrixRowVM[] {
  return [
    row({ id: '1', userId: 'u1', user: 'User One', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
    row({ id: '2', userId: 'u2', user: 'User Two', accessProfile: 'bar', accessProfileId: 'ap-bar', entitlement: 'write', entitlementId: 'e2', source: 'accounting db', sourceId: 's2' }),
  ]
}

// React Flow's pane uses d3-zoom, whose pointer sequence breaks in jsdom, so we
// fire plain DOM events on the card's own (React) handlers rather than driving a
// full pointer/zoom interaction. Geometry is covered by the pure-builder tests;
// here we assert label presence, mode switches, and control wiring only.
describe('AccessGraphCanvas', () => {
  it('defaults to the grid: shows user cards, not role/entitlement/source', () => {
    const graph = deriveAccessGraph(twoUsers())
    render(<AccessGraphCanvas graph={graph} />)

    expect(screen.getByRole('button', { name: 'Show access for User One' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show access for User Two' })).toBeInTheDocument()
    // Non-user labels must not appear in grid mode.
    expect(screen.queryByText('Role A')).not.toBeInTheDocument()
    expect(screen.queryByText('read')).not.toBeInTheDocument()
    expect(screen.queryByText('engr db')).not.toBeInTheDocument()
  })

  it('exposes the user count to screen readers in grid mode', () => {
    const graph = deriveAccessGraph(twoUsers())
    render(<AccessGraphCanvas graph={graph} />)
    expect(screen.getByText(/showing 2 users/i)).toBeInTheDocument()
  })

  it('clicking a user card drills into that user access subgraph', () => {
    const graph = deriveAccessGraph(twoUsers())
    render(<AccessGraphCanvas graph={graph} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    // reference starts hidden by default; show it so the status-less path nodes appear
    fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))

    // User One's path labels appear.
    expect(screen.getByText('Role A')).toBeInTheDocument()
    expect(screen.getByText('read')).toBeInTheDocument()
    expect(screen.getByText('engr db')).toBeInTheDocument()
    // User Two's path stays out of this user's subgraph.
    expect(screen.queryByText('write')).not.toBeInTheDocument()
    expect(screen.queryByText('accounting db')).not.toBeInTheDocument()
  })

  it('activating a user card with keyboard Enter drills in', () => {
    const graph = deriveAccessGraph(twoUsers())
    render(<AccessGraphCanvas graph={graph} />)

    const card = screen.getByRole('button', { name: 'Show access for User Two' })
    fireEvent.keyDown(card, { key: 'Enter' })
    // reference starts hidden by default; show it so the status-less path nodes appear
    fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))

    expect(screen.getByText('bar')).toBeInTheDocument()
    expect(screen.getByText('write')).toBeInTheDocument()
    expect(screen.getByText('accounting db')).toBeInTheDocument()
  })

  it('"Back to all users" returns to the grid', () => {
    const graph = deriveAccessGraph(twoUsers())
    render(<AccessGraphCanvas graph={graph} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    // reference starts hidden by default; show it so the status-less Role A appears
    fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))
    expect(screen.getByText('Role A')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '← All Users' }))

    // Grid is back: user cards present, non-user labels gone.
    expect(screen.getByRole('button', { name: 'Show access for User One' })).toBeInTheDocument()
    expect(screen.queryByText('Role A')).not.toBeInTheDocument()
  })

  describe('backSlot (host-placed "Back to all users")', () => {
    function slot(): HTMLElement {
      const el = document.createElement('div')
      document.body.appendChild(el)
      return el
    }

    it('portals the button into the slot, not into the canvas, and it returns to the grid', () => {
      const host = slot()
      const { container } = render(
        <AccessGraphCanvas graph={deriveAccessGraph(twoUsers())} backSlot={host} />,
      )
      // Grid mode: no back button anywhere.
      expect(within(host).queryByRole('button')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))

      const back = within(host).getByRole('button', { name: '← All Users' })
      expect(back).toBeInTheDocument()
      // Not drawn inside the graph, and no in-canvas nav panel.
      expect(container.querySelector('.react-flow')!.contains(back)).toBe(false)
      expect(container.querySelector('.vc-graph-nav-panel')).toBeNull()

      fireEvent.click(back)
      expect(screen.getByRole('button', { name: 'Show access for User One' })).toBeInTheDocument()
      expect(within(host).queryByRole('button')).toBeNull()
      host.remove()
    })

    it('Escape still returns to the grid when the button is hosted outside', () => {
      const host = slot()
      render(<AccessGraphCanvas graph={deriveAccessGraph(twoUsers())} backSlot={host} />)
      fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
      expect(within(host).getByRole('button', { name: '← All Users' })).toBeInTheDocument()

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(screen.getByRole('button', { name: 'Show access for User One' })).toBeInTheDocument()
      expect(within(host).queryByRole('button')).toBeNull()
      host.remove()
    })

    it('draws no back button at all while the host slot is still pending (null)', () => {
      const { container } = render(
        <AccessGraphCanvas graph={deriveAccessGraph(twoUsers())} backSlot={null} />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
      // reference starts hidden by default; show it so the status-less Role A appears
      fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))
      expect(screen.getByText('Role A')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '← All Users' })).toBeNull()
      expect(container.querySelector('.vc-graph-nav-panel')).toBeNull()
    })

    it('without a slot prop the button stays inside the canvas, in the top-left panel', () => {
      const { container } = render(<AccessGraphCanvas graph={deriveAccessGraph(twoUsers())} />)
      fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
      const nav = container.querySelector('.vc-graph-nav-panel') as HTMLElement
      expect(within(nav).getByRole('button', { name: '← All Users' })).toBeInTheDocument()
    })
  })

  it('renders an empty state when the graph has no users', () => {
    render(<AccessGraphCanvas graph={{ nodes: [], edges: [] }} />)
    expect(screen.getByText('No users to map')).toBeInTheDocument()
  })

  it('marks review status in drill-down: name, four-state corner icon, no chip', () => {
    // One user with four directly-held items covering every state: an undecided
    // role (needsReview), a kept directly-held entitlement (approved), a removed
    // directly-held entitlement (revoked), and a reassigned access profile
    // (reassigned).
    const graph = statusGraph([
      row({
        id: '1',
        userId: 'u1',
        user: 'User One',
        role: 'Role A',
        roleId: 'role-a',
        entitlement: 'read',
        entitlementId: 'e1',
        source: 'engr db',
        sourceId: 's1',
        reviewStatus: 'needsReview',
        accessItemKind: 'role',
        accessItemId: 'role-a',
      }),
      row({
        id: '2',
        userId: 'u1',
        user: 'User One',
        entitlement: 'login',
        entitlementId: 'e2',
        source: 'phone app',
        sourceId: 's2',
        reviewStatus: 'approved',
        accessItemKind: 'entitlement',
        accessItemId: 'e2',
      }),
      row({
        id: '3',
        userId: 'u1',
        user: 'User One',
        entitlement: 'admin',
        entitlementId: 'e4',
        source: 'ops db',
        sourceId: 's4',
        reviewStatus: 'revoked',
        accessItemKind: 'entitlement',
        accessItemId: 'e4',
      }),
      row({
        id: '4',
        userId: 'u1',
        user: 'User One',
        accessProfile: 'Billing AP',
        accessProfileId: 'ap-1',
        entitlement: 'pay',
        entitlementId: 'e3',
        source: 'billing db',
        sourceId: 's3',
        reviewStatus: 'reassigned',
        accessItemKind: 'accessProfile',
        accessItemId: 'ap-1',
      }),
    ])
    render(<AccessGraphCanvas graph={graph} />)

    // Grid shows no legend and no status icons.
    expect(screen.queryByRole('group', { name: /node legend/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /legend/i })).not.toBeInTheDocument()

    // Drill into the user.
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    // completed items start hidden by default; show them so the
    // approved/revoked/reassigned cards are present for this test
    fireEvent.click(screen.getByRole('button', { name: /^Show completed items/ }))

    // Every access-item node renders its NAME (label).
    expect(screen.getByText('Role A')).toBeInTheDocument()
    expect(screen.getByText('login')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('Billing AP')).toBeInTheDocument()

    // The old text status chip is gone entirely.
    expect(screen.queryByLabelText('Review status: Needs review')).toBeNull()
    expect(document.querySelector('.vc-graph-status-chip')).toBeNull()

    // Each directly-held item shows its corner status ICON with a distinct,
    // accessible name.
    const needsReviewIcon = screen.getByLabelText('Needs review')
    expect(needsReviewIcon).toHaveAttribute('data-review-status', 'needsReview')
    const approvedIcon = screen.getByLabelText('Approved')
    expect(approvedIcon).toHaveAttribute('data-review-status', 'approved')
    const revokedIcon = screen.getByLabelText('Revoked')
    expect(revokedIcon).toHaveAttribute('data-review-status', 'revoked')
    const reassignedIcon = screen.getByLabelText('Reassigned')
    expect(reassignedIcon).toHaveAttribute('data-review-status', 'reassigned')

    // No numeric count badge anywhere (the old accessCount edge is gone).
    expect(document.querySelector('.vc-graph-edge-badge')).toBeNull()
  })

  it('places the legend in the bottom-left beside the zoom controls', () => {
    render(<AccessGraphCanvas graph={referenceGraph()} />)
    fireEvent.click(screen.getByRole('button', { name: /show access for/i }))
    // legend starts hidden by default; show it for this test
    fireEvent.click(screen.getByRole('button', { name: 'Show legend' }))
    const legend = screen.getByRole('group', { name: /node legend/i })
    const panel = legend.closest('.react-flow__panel')!
    expect(panel).toHaveClass('vc-graph-legend-panel')
    expect(panel).toHaveClass('bottom')
    expect(panel).toHaveClass('left')
    const controls = document.querySelector('.react-flow__controls')!
    expect(controls).toHaveClass('bottom')
    expect(controls).toHaveClass('left')
    expect(controls).not.toBe(panel)
  })

  it('legend lists type, status, and flag columns separated by vertical rules', () => {
    render(<AccessGraphCanvas graph={referenceGraph()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show legend' }))
    const legend = screen.getByRole('group', { name: /node legend/i })
    const columns = legend.querySelectorAll('.vc-graph-legend-col')
    expect(columns).toHaveLength(3)
    expect(columns[0]).toHaveTextContent('Types')
    expect(columns[1]).toHaveTextContent('Status')
    expect(columns[2]).toHaveTextContent('Flags')
    expect(legend.querySelectorAll('.vc-graph-legend-sep')).toHaveLength(2)
    const kinds = ['User', 'Role', 'Access profile', 'Entitlement', 'Attribute', 'Source']
    for (const label of kinds) expect(within(columns[0] as HTMLElement).getByText(label)).toBeInTheDocument()
    expect(
      Array.from(columns[0].querySelectorAll('.vc-graph-legend-icon')).map((icon) =>
        icon.getAttribute('data-kind'),
      ),
    ).toEqual(['user', 'role', 'accessProfile', 'entitlement', 'attribute', 'source'])
    const statuses = ['Needs Review', 'Approved', 'Revoked', 'Reassigned']
    for (const label of statuses) expect(within(columns[1] as HTMLElement).getByText(label)).toBeInTheDocument()
    expect(
      Array.from(columns[1].querySelectorAll('.vc-graph-status-icon')).map((icon) =>
        icon.getAttribute('data-review-status'),
      ),
    ).toEqual(['needsReview', 'approved', 'revoked', 'reassigned'])
    const flags = [
      'New Access',
      'Birthright Access',
      'High Privilege (Overridden)',
      'Contains Privileged Access',
      'Timebound Access',
      'Comments',
      'Cloud Enabled',
      'Critical Data Access',
    ]
    for (const label of flags) expect(within(columns[2] as HTMLElement).getByText(label)).toBeInTheDocument()
    expect(
      Array.from(columns[2].querySelectorAll('.vc-graph-flag-icon')).map((icon) =>
        icon.getAttribute('data-flag'),
      ),
    ).toEqual([
      'newAccess',
      'birthright',
      'highPrivilege',
      'containsPrivileged',
      'timebound',
      'comments',
      'cloudEnabled',
      'criticalData',
    ])
  })

  it('legend toggle hides and restores the legend panel in drill-down and omits it on the user grid', () => {
    render(<AccessGraphCanvas graph={referenceGraph()} />)
    // The user grid has no legend and no legend control.
    expect(screen.queryByRole('button', { name: /legend/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /node legend/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show access for/i }))
    // legend starts hidden by default; show it to capture the shown baseline
    fireEvent.click(screen.getByRole('button', { name: 'Show legend' }))

    const legendGroup = () => screen.queryByRole('group', { name: /node legend/i })
    expect(legendGroup()).toBeInTheDocument()
    const toggle = () => screen.getByRole('button', { name: /^(Hide|Show) legend$/ })
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(toggle())
    expect(legendGroup()).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle())
    expect(legendGroup()).toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '← All Users' }))
    expect(legendGroup()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /legend/i })).not.toBeInTheDocument()
  })

  /** role-a{ap-foo{e1}} needsReview; e2 held directly (approved). */
  function referenceGraph() {
    return statusGraph([
      row({
        id: '1',
        role: 'Role A',
        roleId: 'role-a',
        accessProfile: 'foo',
        accessProfileId: 'ap-foo',
        entitlement: 'read',
        entitlementId: 'e1',
        source: 'engr db',
        sourceId: 's1',
        reviewStatus: 'needsReview',
        accessItemKind: 'role',
        accessItemId: 'role-a',
      }),
      row({
        id: '2',
        entitlement: 'login',
        entitlementId: 'e2',
        source: 'phone app',
        sourceId: 's2',
        reviewStatus: 'approved',
        accessItemKind: 'entitlement',
        accessItemId: 'e2',
      }),
    ])
  }

  const cardFor = (text: string) => screen.getByText(text).closest<HTMLElement>('.vc-graph-card')!

  it('every first-level card has exactly one icon equal to its card status and its incoming edge status', () => {
    render(<AccessGraphCanvas graph={referenceGraph()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    // completed items start hidden by default; show them so the approved `login` card appears
    fireEvent.click(screen.getByRole('button', { name: /^Show completed items/ }))
    const expected: Record<string, string> = { 'Role A': 'needsReview', login: 'approved' }
    for (const [text, status] of Object.entries(expected)) {
      const card = cardFor(text)
      expect(card).toHaveAttribute('data-review-status', status)
      const icons = card.querySelectorAll('.vc-graph-status-icon')
      expect(icons).toHaveLength(1)
      expect(icons[0]).toHaveAttribute('data-review-status', status)
      expect(card.className).not.toContain('vc-graph-card-reference')
    }
  })

  it('nested-only cards have no status icon and carry the reference class', () => {
    render(<AccessGraphCanvas graph={referenceGraph()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    // reference and completed items start hidden by default; show both so the
    // nested lineage (including phone app under the approved `login`) renders
    fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))
    fireEvent.click(screen.getByRole('button', { name: /^Show completed items/ }))
    for (const text of ['foo', 'read', 'engr db', 'phone app']) {
      const card = cardFor(text)
      expect(card.className).toContain('vc-graph-card-reference')
      expect(card.querySelector('.vc-graph-status-icon')).toBeNull()
      expect(card).not.toHaveAttribute('data-review-status')
    }
    // The user card is never reference.
    expect(cardFor('User One').className).not.toContain('vc-graph-card-reference')
  })

  it('stays in the drill-down when review statuses change but nodes are the same', () => {
    const graph = referenceGraph()
    const { rerender } = render(<AccessGraphCanvas graph={graph} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    // completed items start hidden by default; show them so Role A stays visible
    // after the overlay flips its status from needsReview to approved (completed)
    fireEvent.click(screen.getByRole('button', { name: /^Show completed items/ }))
    expect(screen.getByText('Role A')).toBeInTheDocument()

    // Same nodes array, new edges (what a decision-only overlay rebuild yields).
    const next = {
      nodes: graph.nodes,
      edges: graph.edges.map((e) =>
        e.reviewStatus === 'needsReview' ? { ...e, reviewStatus: 'approved' as const } : e,
      ),
    }
    rerender(<AccessGraphCanvas graph={next} />)
    expect(screen.getByText('Role A')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show access for User One' })).toBeNull()

    // A genuinely new node set returns to the grid.
    rerender(<AccessGraphCanvas graph={{ nodes: [...graph.nodes], edges: next.edges }} />)
    expect(screen.getByRole('button', { name: 'Show access for User One' })).toBeInTheDocument()
  })

  it('shows a description tooltip on access item cards, and none on user or reference-only cards', () => {
    const longRole = 'Enterprise Data Platform Administrator (Production)'
    const graph = deriveAccessGraph([
      row({
        id: '1',
        userId: 'u1',
        user: 'User One',
        role: longRole,
        roleId: 'r1',
        roleDescription: 'Administers the production data platform',
        accessProfile: 'foo',
        accessProfileId: 'ap1',
        accessProfileDescription: '   ',
        entitlement: 'read',
        entitlementId: 'e1',
        source: 'engr db',
        sourceId: 's1',
        sourceDescription: 'Engineering database',
      }),
    ])
    render(<AccessGraphCanvas graph={graph} />)

    const userCard = screen.getByRole('button', { name: 'Show access for User One' })
    fireEvent.mouseEnter(userCard)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.focus(userCard)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.mouseLeave(userCard)

    fireEvent.click(userCard)
    // reference starts hidden by default; show it so the status-less access
    // items and the source card are present
    fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))
    const roleCard = screen.getByLabelText(`Role: ${longRole}`)
    expect(roleCard).toHaveAccessibleName(`Role: ${longRole}`)
    fireEvent.mouseEnter(roleCard)
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Administers the production data platform')
    expect(roleCard).toHaveAttribute('aria-describedby', tip.id)
    fireEvent.mouseLeave(roleCard)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.focus(roleCard)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Administers the production data platform')
    fireEvent.blur(roleCard)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    const profile = screen.getByLabelText('Access profile: foo')
    fireEvent.mouseEnter(profile)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Description not set')
    fireEvent.mouseLeave(profile)

    const entitlement = screen.getByLabelText('Entitlement: read')
    fireEvent.mouseEnter(entitlement)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Description not set')
    fireEvent.mouseLeave(entitlement)

    fireEvent.mouseEnter(screen.getByLabelText('Source: engr db'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByLabelText('User: User One'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  describe('graph controls panel', () => {
    const liveRegions = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[aria-live="polite"]'))
    const announcement = () => liveRegions()[1]
    const drillIn = (name = 'User One') =>
      fireEvent.click(screen.getByRole('button', { name: `Show access for ${name}` }))
    const btn = (name: string | RegExp) => screen.getByRole('button', { name })

    /** Two users, each with a first-level item that also has nested lineage. */
    function twoStatusUsers() {
      return statusGraph([
        row({ id: '1', userId: 'u1', user: 'User One', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-a' }),
        row({ id: '2', userId: 'u2', user: 'User Two', role: 'Role B', roleId: 'role-b', accessProfile: 'bar', accessProfileId: 'ap-bar', entitlement: 'write', entitlementId: 'e2', source: 'acct db', sourceId: 's2', reviewStatus: 'approved', accessItemKind: 'role', accessItemId: 'role-b' }),
      ])
    }

    it('renders the toolbar in a left panel in grid and drill-down, buttons in order', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
      const check = () => {
        const toolbar = screen.getByRole('toolbar', { name: 'Graph controls' })
        const panel = toolbar.closest('.react-flow__panel')!
        expect(panel).toHaveClass('left')
        expect(panel).toHaveClass('vc-graph-controls-panel')
        const labels = Array.from(toolbar.querySelectorAll('button')).map((b) =>
          b.getAttribute('aria-label'),
        )
        return labels
      }
      // The user grid control panel is only the minimap. Every option starts
      // hidden, so the toggle reads "Show minimap".
      expect(check()).toEqual(['Show minimap'])
      drillIn()
      // layout now starts in TB, so the layout button reads "Layout: horizontal" and is unpressed
      expect(check()).toEqual([
        'Layout: horizontal',
        'Show reference nodes and links',
        'Show completed items (1 hidden)',
        'Show legend',
        'Show minimap',
        'Show details panel',
      ])
    })

    it('pins the drilled-in user card in the upper left, beside the controls', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
      drillIn()
      const pin = document.querySelector('.vc-graph-user-pin')
      expect(pin).not.toBeNull()
      expect(pin).toHaveClass('top', 'left')
      expect(pin?.querySelector('.vc-graph-card-label')).toHaveTextContent('User One')
      expect(document.querySelector('.react-flow__node[data-id="user:u1"]')).toBeNull()
      // The toolbar stays the leftmost top panel; the card is shifted beside it.
      const toolbar = screen.getByRole('toolbar', { name: 'Graph controls' })
      expect(toolbar.closest('.react-flow__panel')).not.toHaveClass('vc-graph-user-pin')
    })

    it('removes the old layout button from the top-left panel; Back still works', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
      drillIn()
      const nav = document.querySelector('.vc-graph-nav-panel')!
      expect(within(nav as HTMLElement).getByRole('button', { name: '← All Users' })).toBeInTheDocument()
      expect(within(nav as HTMLElement).queryByRole('button', { name: /^Layout/ })).toBeNull()
      fireEvent.click(btn('← All Users'))
      expect(screen.getByRole('button', { name: 'Show access for User One' })).toBeInTheDocument()
    })

    it('layout toggle flips the label and pressed state; absent in the grid', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
      expect(screen.queryByRole('button', { name: /^Layout/ })).not.toBeInTheDocument()
      drillIn()
      // layout now starts in TB: the button is unpressed and reads "Layout: horizontal"
      expect(btn('Layout: horizontal')).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(btn('Layout: horizontal'))
      expect(btn('Layout: vertical')).toHaveAttribute('aria-pressed', 'true')
      expect(announcement()).toHaveTextContent('Layout changed to vertical.')
      fireEvent.click(btn('Layout: vertical'))
      expect(btn('Layout: horizontal')).toBeInTheDocument()
      expect(announcement()).toHaveTextContent('Layout changed to horizontal.')
    })

    it('minimap toggle hides/shows the minimap in grid and drill-down', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
      // minimap starts hidden by default; show it to capture the shown baseline
      fireEvent.click(btn('Show minimap'))
      expect(document.querySelector('.react-flow__minimap')).not.toBeNull()
      expect(btn('Hide minimap')).toHaveAttribute('aria-pressed', 'true')

      fireEvent.click(btn('Hide minimap'))
      expect(document.querySelector('.react-flow__minimap')).toBeNull()
      expect(btn('Show minimap')).toHaveAttribute('aria-pressed', 'false')
      expect(announcement()).toHaveTextContent('Minimap hidden.')

      // The hidden preference survives drilling in.
      drillIn()
      expect(document.querySelector('.react-flow__minimap')).toBeNull()

      fireEvent.click(btn('Show minimap'))
      expect(document.querySelector('.react-flow__minimap')).not.toBeNull()
      expect(announcement()).toHaveTextContent('Minimap shown.')
    })

    it('reference toggle removes nested items, sources and edges; restores them', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
      expect(screen.queryByRole('button', { name: /^Reference nodes/ })).not.toBeInTheDocument()
      drillIn()
      // reference and completed items start hidden by default; show each so the
      // nested lineage and the approved `login` card form the shown baseline.
      // The node legend stays the same either way.
      fireEvent.click(btn('Show reference nodes and links'))
      fireEvent.click(btn(/^Show completed items/))
      fireEvent.click(btn('Show legend'))
      const nestedLabels = ['foo', 'read', 'engr db', 'phone app']
      for (const t of nestedLabels) expect(screen.getByText(t)).toBeInTheDocument()
      const legend = screen.getByRole('group', { name: /node legend/i })
      expect(legend).toHaveTextContent('Source')
      expect(btn('Hide reference nodes and links')).toHaveAttribute('aria-pressed', 'true')

      fireEvent.click(btn('Hide reference nodes and links'))
      for (const t of nestedLabels) expect(screen.queryByText(t)).toBeNull()
      expect(document.querySelector('.vc-graph-card-reference')).toBeNull()
      expect(document.querySelector('.vc-graph-edge-reference')).toBeNull()
      expect(btn('Show reference nodes and links')).toHaveAttribute('aria-pressed', 'false')
      expect(announcement()).toHaveTextContent('Reference nodes and links hidden.')

      // First level and statuses are intact, and the node legend is unchanged.
      for (const t of ['Role A', 'login', 'User One']) expect(screen.getByText(t)).toBeInTheDocument()
      expect(document.querySelectorAll('.react-flow__node .vc-graph-status-icon')).toHaveLength(2)
      expect(legend.querySelectorAll('.vc-graph-legend-icon')).toHaveLength(6)

      fireEvent.click(btn('Show reference nodes and links'))
      for (const t of nestedLabels) expect(screen.getByText(t)).toBeInTheDocument()
      expect(legend.querySelectorAll('.vc-graph-legend-icon')).toHaveLength(6)
      expect(announcement()).toHaveTextContent('Reference nodes and links shown.')
    })

    it('hidden reference survives switching users and grid round trips', () => {
      render(<AccessGraphCanvas graph={twoStatusUsers()} />)
      drillIn('User One')
      // reference starts hidden by default, so the nested `read` is already gone
      expect(screen.queryByText('read')).toBeNull()

      fireEvent.click(btn('← All Users'))
      // The reference control is drill-down only; the preference is kept.
      expect(screen.queryByRole('button', { name: /^Reference nodes/ })).not.toBeInTheDocument()
      drillIn('User Two')
      // User Two's Role B is approved (completed); completed items start hidden
      // by default, so show them to assert Role B's reference behavior here
      fireEvent.click(btn(/^Show completed items/))
      expect(screen.getByText('Role B')).toBeInTheDocument()
      expect(screen.queryByText('write')).toBeNull()
      expect(screen.queryByText('acct db')).toBeNull()
      expect(btn('Show reference nodes and links')).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(btn('Show reference nodes and links'))
      expect(screen.getByText('write')).toBeInTheDocument()
    })

    it('layout preference survives switching users', () => {
      render(<AccessGraphCanvas graph={twoStatusUsers()} />)
      drillIn('User One')
      // layout now starts in TB; switch to horizontal (LR) to set a non-default preference
      fireEvent.click(btn('Layout: horizontal'))
      fireEvent.click(btn('← All Users'))
      drillIn('User Two')
      // the LR preference survives: the button now reads "Layout: vertical"
      expect(btn('Layout: vertical')).toBeInTheDocument()
    })

    it('still renders a node that is both first-level and nested when reference is hidden', async () => {
      const graph = await buildFixtureGraph()
      render(<AccessGraphCanvas graph={graph} />)
      drillIn('Alice Adams')
      // reference starts hidden by default (the precondition this test wants);
      // completed items start hidden too, so show them to reveal the approved `Read`
      fireEvent.click(btn(/^Show completed items/))
      // e-read ("Read") is held directly by Alice and also nested under Role A.
      const card = screen.getByText('Read').closest<HTMLElement>('.vc-graph-card')!
      expect(card).toHaveAttribute('data-review-status', 'approved')
      expect(card.className).not.toContain('vc-graph-card-reference')
      // Nested-only "Write" is gone.
      expect(screen.queryByText('Write')).toBeNull()
    })

    it('does not show the no-expanded-access note when hiding reference for a user with lineage', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
      drillIn()
      // reference starts hidden by default, which is the precondition here
      expect(screen.queryByText('No expanded access for this user.')).toBeNull()
    })

    it('shows the note for a user with no lineage, outside the right panel', () => {
      const graph = deriveAccessGraph([
        row({ id: '1', userId: 'u1', user: 'User One' }),
        row({ id: '2', userId: 'u2', user: 'User Two', entitlement: 'x', entitlementId: 'e9', source: 's', sourceId: 's9' }),
      ])
      render(<AccessGraphCanvas graph={graph} />)
      drillIn('User One')
      const note = screen.getByText('No expanded access for this user.')
      const panel = note.closest('.react-flow__panel')!
      expect(panel).toHaveClass('top')
      expect(panel).toHaveClass('center')
      expect(panel).not.toHaveClass('right')
    })

    describe('hide completed items', () => {
      const R = (o: Partial<StatusRow>) =>
        row({ userId: 'u1', user: 'User One', ...o })

      /**
       * User One: Role A (approved) -> foo -> read -> ERP; Role B (needsReview)
       * -> read and -> shared; Shared held directly (revoked) AND nested under
       * Role B; Billing AP (reassigned) -> pay -> Payroll; Login (needsReview)
       * -> Directory; Legacy (approved) -> Directory. Hidden items: Role A,
       * Shared, Billing AP, Legacy (4).
       * User Two: every item complete. User Three: no lineage at all.
       */
      function completedGraph() {
        return statusGraph([
          R({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e-read', source: 'ERP', sourceId: 's-erp', reviewStatus: 'approved', accessItemKind: 'role', accessItemId: 'role-a' }),
          R({ id: '2', role: 'Role B', roleId: 'role-b', entitlement: 'read', entitlementId: 'e-read', source: 'ERP', sourceId: 's-erp', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-b' }),
          R({ id: '3', role: 'Role B', roleId: 'role-b', entitlement: 'Shared', entitlementId: 'e-sh', source: 'ERP', sourceId: 's-erp', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-b' }),
          R({ id: '4', entitlement: 'Shared', entitlementId: 'e-sh', source: 'ERP', sourceId: 's-erp', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e-sh' }),
          R({ id: '5', accessProfile: 'Billing AP', accessProfileId: 'ap-bill', entitlement: 'pay', entitlementId: 'e-pay', source: 'Payroll', sourceId: 's-pay', reviewStatus: 'reassigned', accessItemKind: 'accessProfile', accessItemId: 'ap-bill' }),
          R({ id: '6', entitlement: 'Login', entitlementId: 'e-login', source: 'Directory', sourceId: 's-dir', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: 'e-login' }),
          R({ id: '7', entitlement: 'Legacy', entitlementId: 'e-leg', source: 'Directory', sourceId: 's-dir', reviewStatus: 'approved', accessItemKind: 'entitlement', accessItemId: 'e-leg' }),
          row({ id: '8', userId: 'u2', user: 'User Two', role: 'Role X', roleId: 'role-x', entitlement: 'xread', entitlementId: 'e-x', source: 'XDB', sourceId: 's-x', reviewStatus: 'approved', accessItemKind: 'role', accessItemId: 'role-x' }),
          row({ id: '9', userId: 'u2', user: 'User Two', entitlement: 'xadmin', entitlementId: 'e-xa', source: 'XDB', sourceId: 's-x', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e-xa' }),
          row({ id: '10', userId: 'u3', user: 'User Three' }),
        ])
      }
      const label = (text: string) => screen.queryByText(text)
      const cardOf = (text: string) => screen.getByText(text).closest<HTMLElement>('.vc-graph-card')!
      const nodeLabels = () =>
        Array.from(document.querySelectorAll('.react-flow__node .vc-graph-card-label')).map(
          (c) => c.textContent,
        )
      const COMPLETED_ONLY = ['Role A', 'foo', 'Billing AP', 'pay', 'Payroll', 'Legacy']
      const KEPT = ['Role B', 'read', 'ERP', 'Login', 'Directory', 'Shared']

      it('is enabled and unpressed by default in drill-down, absent in the grid', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        expect(screen.queryByRole('button', { name: /completed items/i })).not.toBeInTheDocument()
        drillIn()
        // reference starts hidden by default; show it so the needs-review lineage
        // in KEPT (read, ERP, Directory, Shared) is present for the comparison
        fireEvent.click(btn('Show reference nodes and links'))
        // Completed items start hidden by default: the toggle is enabled but
        // unpressed, and only the needs-review (KEPT) items are visible.
        const completed = btn(/^Show completed items/)
        expect(completed).toBeEnabled()
        expect(completed).toHaveAttribute('aria-pressed', 'false')
        expect(completed).not.toHaveClass('vc-graph-control-active')
        for (const t of COMPLETED_ONLY) expect(label(t)).toBeNull()
        for (const t of KEPT) expect(label(t)).toBeInTheDocument()
        // Showing them reveals every item and flips the toggle to pressed.
        fireEvent.click(completed)
        for (const t of [...COMPLETED_ONLY, ...KEPT]) expect(label(t)).toBeInTheDocument()
        expect(btn('Hide completed items')).toHaveAttribute('aria-pressed', 'true')
      })

      it('hides completed cards, keeps needs-review ones and announces the count', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn()
        // completed items start hidden by default; show them to capture the
        // shown baseline, then hide them to exercise the hide path/announcement.
        // reference and legend start hidden too; show them so the node legend
        // is present to assert it is unchanged.
        fireEvent.click(btn(/^Show completed items/))
        fireEvent.click(btn('Show reference nodes and links'))
        fireEvent.click(btn('Show legend'))
        fireEvent.click(btn('Hide completed items'))

        for (const t of COMPLETED_ONLY) expect(label(t)).toBeNull()
        for (const t of KEPT) expect(label(t)).toBeInTheDocument()
        const hidden = btn('Show completed items (4 hidden)')
        expect(hidden).toHaveAttribute('aria-pressed', 'false')
        expect(hidden).not.toHaveClass('vc-graph-control-active')
        expect(hidden.querySelector('svg')).toHaveAttribute('data-icon', 'completedHidden')
        expect(announcement()).toHaveTextContent('Completed items hidden (4).')
        // Node legend unchanged.
        const legend = screen.getByRole('group', { name: /node legend/i })
        expect(legend.querySelectorAll('.vc-graph-legend-icon')).toHaveLength(6)
        expect(legend).toHaveTextContent('Entitlement')
      })

      it('keeps a directly-held completed entitlement that is nested under a visible item as muted reference', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn()
        // completed items start hidden by default; show them so the revoked
        // `Shared` card is present as the shown baseline before hiding.
        // reference starts hidden too; show it so the demoted `Shared` survives
        // as a muted reference card once completed items are hidden.
        fireEvent.click(btn(/^Show completed items/))
        fireEvent.click(btn('Show reference nodes and links'))
        expect(cardOf('Shared')).toHaveAttribute('data-review-status', 'revoked')
        fireEvent.click(btn('Hide completed items'))
        const shared = cardOf('Shared')
        expect(shared).toHaveClass('vc-graph-card-reference')
        expect(shared.querySelector('.vc-graph-status-icon')).toBeNull()
        expect(shared).toHaveAttribute('aria-pressed', 'false')
        // The needs-review ones still carry their status.
        expect(cardOf('Role B')).toHaveAttribute('data-review-status', 'needsReview')
        expect(cardOf('Login')).toHaveAttribute('data-review-status', 'needsReview')
      })

      it('shows the completed items again, restoring the original cards', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn()
        // completed items start hidden by default; show them to capture the
        // full shown baseline this round-trip restores to
        fireEvent.click(btn(/^Show completed items/))
        const before = nodeLabels()
        fireEvent.click(btn('Hide completed items'))
        expect(nodeLabels()).not.toEqual(before)
        fireEvent.click(btn('Show completed items (4 hidden)'))
        expect(nodeLabels()).toEqual(before)
        expect(btn('Hide completed items')).toHaveAttribute('aria-pressed', 'true')
        expect(announcement()).toHaveTextContent('Completed items shown.')
        expect(cardOf('Shared')).toHaveAttribute('data-review-status', 'revoked')
      })

      it('composes with the reference toggle in either order', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn()
        // completed and reference both start hidden by default, which is exactly
        // the both-filters-on state this test's baseline `a` captures.
        const a = nodeLabels().sort()
        // Needs-review first-level items stay in the graph. The user card is
        // pinned beside the controls, not a flow node.
        expect(a).toEqual(['Login', 'Role B'].map((t) => expect.stringContaining(t)))
        expect(document.querySelector('.vc-graph-user-pin')).toHaveTextContent('User One')
        fireEvent.click(btn('Show reference nodes and links'))
        fireEvent.click(btn('Show completed items (4 hidden)'))
        fireEvent.click(btn('Hide reference nodes and links'))
        fireEvent.click(btn('Hide completed items'))
        expect(nodeLabels().sort()).toEqual(a)
        // Showing completed again with reference hidden restores first-level only.
        fireEvent.click(btn(/^Show completed items/))
        for (const t of ['Role A', 'Billing AP', 'Legacy', 'Shared']) expect(label(t)).toBeInTheDocument()
        for (const t of ['foo', 'pay', 'ERP', 'Payroll', 'Directory']) expect(label(t)).toBeNull()
      })

      it('survives Back-to-all-users and switching users, using each user own count', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn()
        // completed items start hidden by default, so the hidden preference is
        // already in effect before navigating between users
        fireEvent.click(btn('← All Users'))
        // Grid: the completed control is absent, and all users are present.
        expect(screen.queryByRole('button', { name: /completed items/i })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Show access for User Two' })).toBeInTheDocument()
        drillIn('User Two')
        expect(btn('Show completed items (2 hidden)')).toHaveAttribute('aria-pressed', 'false')
        expect(label('Role X')).toBeNull()
        fireEvent.click(btn('← All Users'))
        drillIn('User One')
        expect(label('Role A')).toBeNull()
        expect(label('Role B')).toBeInTheDocument()
        fireEvent.click(btn('Show completed items (4 hidden)'))
        expect(label('Role A')).toBeInTheDocument()
      })

      it('shows the all-complete note instead of the empty-user note when everything is hidden', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn('User Two')
        // completed items start hidden by default; show them so the all-complete
        // note is absent as the shown baseline, then hide to make it appear
        fireEvent.click(btn(/^Show completed items/))
        expect(label('All access items are complete. Show completed items to see them.')).toBeNull()
        fireEvent.click(btn('Hide completed items'))
        const note = screen.getByText('All access items are complete. Show completed items to see them.')
        const panel = note.closest('.react-flow__panel')!
        expect(panel).toHaveClass('top')
        expect(panel).toHaveClass('center')
        expect(label('No expanded access for this user.')).toBeNull()
        // No access items left in the graph; the user stays on the pinned card.
        expect(nodeLabels()).toEqual([])
        expect(document.querySelector('.vc-graph-user-pin')).toHaveTextContent('User Two')
        fireEvent.click(btn('Show completed items (2 hidden)'))
        expect(label('All access items are complete. Show completed items to see them.')).toBeNull()
        expect(label('Role X')).toBeInTheDocument()
      })

      it('keeps the old note for a genuinely empty user, even after toggling', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn('User Three')
        expect(label('No expanded access for this user.')).toBeInTheDocument()
        // completed items start hidden by default; toggle them on then off to
        // confirm a genuinely empty user keeps the old note either way
        fireEvent.click(btn('Show completed items (0 hidden)'))
        fireEvent.click(btn('Hide completed items'))
        expect(btn('Show completed items (0 hidden)')).toBeInTheDocument()
        expect(label('No expanded access for this user.')).toBeInTheDocument()
        expect(label('All access items are complete. Show completed items to see them.')).toBeNull()
      })

      it('never hides a status-less first-level item or a mixed-status item', () => {
        const unstatused = {
          nodes: [
            { id: 'user:u1', kind: 'user' as const, label: 'User One' },
            { id: 'role:r', kind: 'role' as const, label: 'Unreviewed' },
          ],
          edges: [{ from: 'user:u1', to: 'role:r', pathCount: 1, firstLevel: true }],
        }
        const { unmount } = render(<AccessGraphCanvas graph={unstatused} />)
        drillIn()
        // reference starts hidden by default and a status-less item is reference
        // content; show reference so this asserts the COMPLETED filter alone.
        fireEvent.click(btn('Show reference nodes and links'))
        // completed items start hidden by default; the status-less item is never
        // treated as completed, so it stays visible with a zero hidden count
        expect(label('Unreviewed')).toBeInTheDocument()
        expect(btn('Show completed items (0 hidden)')).toBeInTheDocument()
        unmount()

        // Two review items of one role: one approved, one needs review -> mixed.
        const mixed = statusGraph([
          R({ id: 'm1', role: 'Role M', roleId: 'role-m', entitlement: 'a', entitlementId: 'ea', reviewStatus: 'approved', accessItemKind: 'role', accessItemId: 'role-m' }),
          R({ id: 'm2', role: 'Role M', roleId: 'role-m', entitlement: 'b', entitlementId: 'eb', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-m' }),
        ])
        render(<AccessGraphCanvas graph={mixed} />)
        drillIn()
        // completed items start hidden by default; a mixed-status item aggregates
        // to needsReview, so it is never hidden and the hidden count stays zero
        expect(label('Role M')).toBeInTheDocument()
        expect(btn('Show completed items (0 hidden)')).toBeInTheDocument()
      })

      it('shows the hidden count in the hover hint', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn()
        // completed items start hidden by default, so the toggle already shows
        // the hidden count in its label and hint
        const anchor = btn('Show completed items (4 hidden)').closest<HTMLElement>(
          '.vc-graph-hint-anchor',
        )!
        stubAnchorRect(anchor)
        fireEvent.mouseEnter(anchor)
        expect(screen.getByRole('tooltip')).toHaveTextContent('Show completed items (4 hidden)')
      })
    })

    it('shows a tooltip on a panel button; Escape closes it first, then leaves the drill-down', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
      drillIn()
      // minimap starts hidden by default, so the toggle reads "Show minimap"
      const minimap = btn('Show minimap')
      const anchor = minimap.closest<HTMLElement>('.vc-graph-hint-anchor')!
      stubAnchorRect(anchor)
      fireEvent.mouseEnter(anchor)
      expect(screen.getByRole('tooltip')).toHaveTextContent('Show minimap')
      fireEvent.mouseLeave(anchor)
      expect(screen.queryByRole('tooltip')).toBeNull()

      fireEvent.focus(minimap)
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
      fireEvent.keyDown(minimap, { key: 'Escape' })
      expect(screen.queryByRole('tooltip')).toBeNull()
      expect(screen.getByText('Role A')).toBeInTheDocument()

      fireEvent.keyDown(minimap, { key: 'Escape' })
      expect(screen.getByRole('button', { name: 'Show access for User One' })).toBeInTheDocument()
    })
  })
})

/** Scoped rect for a control-panel hint anchor (the anchor itself is measured). */
function stubAnchorRect(el: HTMLElement): void {
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
