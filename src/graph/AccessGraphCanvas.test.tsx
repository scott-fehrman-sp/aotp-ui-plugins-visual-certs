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

    expect(screen.getByText('bar')).toBeInTheDocument()
    expect(screen.getByText('write')).toBeInTheDocument()
    expect(screen.getByText('accounting db')).toBeInTheDocument()
  })

  it('"Back to all users" returns to the grid', () => {
    const graph = deriveAccessGraph(twoUsers())
    render(<AccessGraphCanvas graph={graph} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    expect(screen.getByText('Role A')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /back to all users/i }))

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

      const back = within(host).getByRole('button', { name: /back to all users/i })
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
      expect(within(host).getByRole('button', { name: /back to all users/i })).toBeInTheDocument()

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
      expect(screen.getByText('Role A')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /back to all users/i })).toBeNull()
      expect(container.querySelector('.vc-graph-nav-panel')).toBeNull()
    })

    it('without a slot prop the button stays inside the canvas, in the top-left panel', () => {
      const { container } = render(<AccessGraphCanvas graph={deriveAccessGraph(twoUsers())} />)
      fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
      const nav = container.querySelector('.vc-graph-nav-panel') as HTMLElement
      expect(within(nav).getByRole('button', { name: /back to all users/i })).toBeInTheDocument()
    })
  })

  it('renders an empty state when the graph has no users', () => {
    render(<AccessGraphCanvas graph={{ nodes: [], edges: [] }} />)
    expect(screen.getByText('No users to map')).toBeInTheDocument()
  })

  it('marks review status in drill-down: name, four-state corner icon, legend, no chip', () => {
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
    expect(screen.queryByRole('group', { name: /review status legend/i })).not.toBeInTheDocument()

    // Drill into the user.
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))

    // Every access-item node renders its NAME (label).
    expect(screen.getByText('Role A')).toBeInTheDocument()
    expect(screen.getByText('login')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('Billing AP')).toBeInTheDocument()

    // The old text status chip is gone entirely.
    expect(screen.queryByLabelText('Review status: Needs review')).toBeNull()
    expect(document.querySelector('.vc-graph-status-chip')).toBeNull()

    // Each directly-held item shows its corner status ICON with a distinct,
    // accessible name. The legend's icons are decorative (aria-hidden), so the
    // only accessibly-named icon per status is the node's.
    const needsReviewIcon = screen.getByLabelText('Needs review')
    expect(needsReviewIcon).toHaveAttribute('data-review-status', 'needsReview')
    const approvedIcon = screen.getByLabelText('Approved')
    expect(approvedIcon).toHaveAttribute('data-review-status', 'approved')
    const revokedIcon = screen.getByLabelText('Revoked')
    expect(revokedIcon).toHaveAttribute('data-review-status', 'revoked')
    const reassignedIcon = screen.getByLabelText('Reassigned')
    expect(reassignedIcon).toHaveAttribute('data-review-status', 'reassigned')

    // The legend lists all four states.
    const legend = screen.getByRole('group', { name: /review status legend/i })
    expect(legend).toHaveTextContent('Needs review')
    expect(legend).toHaveTextContent('Approved')
    expect(legend).toHaveTextContent('Revoked')
    expect(legend).toHaveTextContent('Reassigned')

    // No numeric count badge anywhere (the old accessCount edge is gone).
    expect(document.querySelector('.vc-graph-edge-badge')).toBeNull()
  })

  it('places the legend in a panel that clears the zoom controls', () => {
    render(<AccessGraphCanvas graph={referenceGraph()} />)
    fireEvent.click(screen.getByRole('button', { name: /show access for/i }))
    const legend = screen.getByRole('group', { name: /review status legend/i })
    expect(legend.closest('.react-flow__panel')).toHaveClass('vc-graph-legend-panel')
  })

  it('legend toggle hides and restores the legend panel in drill-down', () => {
    render(<AccessGraphCanvas graph={referenceGraph()} />)
    // Disabled in the grid, where there is no legend.
    expect(screen.getByRole('button', { name: /^Legend \(open a user/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /show access for/i }))

    const legendGroup = () => screen.queryByRole('group', { name: /review status legend/i })
    expect(legendGroup()).toBeInTheDocument()
    const toggle = () => screen.getByRole('button', { name: /^(Hide|Show) legend$/ })
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(toggle())
    expect(legendGroup()).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle())
    expect(legendGroup()).toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
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

  it('legend lists a Reference Only entry distinct from the four statuses', () => {
    render(<AccessGraphCanvas graph={referenceGraph()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    const legend = screen.getByRole('group', { name: /review status legend/i })
    expect(legend).toHaveTextContent('Reference Only')
    // The reference entry is a hairline swatch, not a status icon.
    expect(legend.querySelectorAll('.vc-graph-status-icon')).toHaveLength(4)
    expect(legend.querySelector('.vc-graph-legend-swatch-reference')).not.toBeNull()
  })

  it('every first-level card has exactly one icon equal to its card status and its incoming edge status', () => {
    render(<AccessGraphCanvas graph={referenceGraph()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
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

  it('shows a styled tooltip with the kind and full (untruncated) label on hover', () => {
    // A role name long enough that the card would ellipsis-clip it; the tooltip
    // must still reveal the complete name so a reviewer can read it on hover.
    const longRole = 'Enterprise Data Platform Administrator (Production)'
    const graph = deriveAccessGraph([
      row({ id: '1', userId: 'u1', user: 'User One', role: longRole, roleId: 'r1', accessProfile: 'foo', accessProfileId: 'ap1', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
    ])
    render(<AccessGraphCanvas graph={graph} />)

    // No tooltip until hovered.
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    // Hovering the grid-mode user card opens a styled (role=tooltip) popover.
    const userCard = screen.getByRole('button', { name: 'Show access for User One' })
    const userAnchor = userCard.closest<HTMLElement>('.vc-node-tooltip-anchor')!
    stubRect(userAnchor)
    fireEvent.mouseEnter(userAnchor)
    const userTip = screen.getByRole('tooltip')
    expect(userTip).toHaveTextContent('User')
    expect(userTip).toHaveTextContent('User One')
    // It closes on mouse leave.
    fireEvent.mouseLeave(userAnchor)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    // Drill in; hovering the long role card reveals the full name.
    fireEvent.click(userCard)
    const roleAnchor = screen.getByText(longRole).closest<HTMLElement>('.vc-node-tooltip-anchor')!
    stubRect(roleAnchor)
    fireEvent.mouseEnter(roleAnchor)
    const roleTip = screen.getByRole('tooltip')
    expect(roleTip).toHaveTextContent('Role')
    expect(roleTip).toHaveTextContent(longRole)
  })

  it('opens the node tooltip on keyboard focus too', () => {
    const graph = deriveAccessGraph([
      row({ id: '1', userId: 'u1', user: 'User One', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
    ])
    render(<AccessGraphCanvas graph={graph} />)

    const anchor = screen
      .getByRole('button', { name: 'Show access for User One' })
      .closest<HTMLElement>('.vc-node-tooltip-anchor')!
    stubRect(anchor)
    fireEvent.focus(anchor)
    expect(screen.getByRole('tooltip')).toHaveTextContent('User One')
  })

  it('shows department + location on the user tooltip and description on a role tooltip', () => {
    // The user carries department/location; the role carries a description.
    const graph = deriveAccessGraph([
      row({
        id: '1',
        userId: 'u1',
        user: 'User One',
        userDepartment: 'Engineering',
        userLocation: 'Austin',
        role: 'Role A',
        roleId: 'r1',
        roleDescription: 'Grants engineering platform access',
        entitlement: 'read',
        entitlementId: 'e1',
        source: 'engr db',
        sourceId: 's1',
      }),
    ])
    render(<AccessGraphCanvas graph={graph} />)

    // Hover the user card: Department + Location lines appear.
    const userCard = screen.getByRole('button', { name: 'Show access for User One' })
    const userAnchor = userCard.closest<HTMLElement>('.vc-node-tooltip-anchor')!
    stubRect(userAnchor)
    fireEvent.mouseEnter(userAnchor)
    const userTip = screen.getByRole('tooltip')
    expect(userTip).toHaveTextContent('Department:')
    expect(userTip).toHaveTextContent('Engineering')
    expect(userTip).toHaveTextContent('Location:')
    expect(userTip).toHaveTextContent('Austin')
    // A user tooltip never shows a Description label.
    expect(userTip).not.toHaveTextContent('Description:')
    fireEvent.mouseLeave(userAnchor)

    // Drill in; hover the role: its Description appears.
    fireEvent.click(userCard)
    const roleAnchor = screen.getByText('Role A').closest<HTMLElement>('.vc-node-tooltip-anchor')!
    stubRect(roleAnchor)
    fireEvent.mouseEnter(roleAnchor)
    const roleTip = screen.getByRole('tooltip')
    expect(roleTip).toHaveTextContent('Description:')
    expect(roleTip).toHaveTextContent('Grants engineering platform access')
  })

  it('shows "not set" for a non-user node missing a description; user tooltip never shows Description', () => {
    // No department/location/description anywhere.
    const graph = deriveAccessGraph([
      row({ id: '1', userId: 'u1', user: 'User One', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
    ])
    render(<AccessGraphCanvas graph={graph} />)

    // A user node never shows a Description line (users have dept/location only).
    const userCard = screen.getByRole('button', { name: 'Show access for User One' })
    const userAnchor = userCard.closest<HTMLElement>('.vc-node-tooltip-anchor')!
    stubRect(userAnchor)
    fireEvent.mouseEnter(userAnchor)
    const userTip = screen.getByRole('tooltip')
    expect(userTip).toHaveTextContent('User One')
    expect(userTip).not.toHaveTextContent('Department:')
    expect(userTip).not.toHaveTextContent('Location:')
    expect(userTip).not.toHaveTextContent('Description:')
    fireEvent.mouseLeave(userAnchor)

    // Drill in; a source node with no description still shows the Description
    // line, with the value "not set".
    fireEvent.click(userCard)
    const sourceAnchor = screen.getByText('engr db').closest<HTMLElement>('.vc-node-tooltip-anchor')!
    stubRect(sourceAnchor)
    fireEvent.mouseEnter(sourceAnchor)
    const sourceTip = screen.getByRole('tooltip')
    expect(sourceTip).toHaveTextContent('Source')
    expect(sourceTip).toHaveTextContent('engr db')
    expect(sourceTip).toHaveTextContent('Description:')
    expect(sourceTip).toHaveTextContent('not set')
    fireEvent.mouseLeave(sourceAnchor)

    // The entitlement node (also no description) shows "not set" too.
    const entAnchor = screen.getByText('read').closest<HTMLElement>('.vc-node-tooltip-anchor')!
    stubRect(entAnchor)
    fireEvent.mouseEnter(entAnchor)
    const entTip = screen.getByRole('tooltip')
    expect(entTip).toHaveTextContent('Description:')
    expect(entTip).toHaveTextContent('not set')
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
      expect(check()).toEqual([
        'Layout (open a user to change)',
        'Reference nodes and links (open a user to change)',
        'Completed items (open a user to filter)',
        'Legend (open a user to change)',
        'Hide minimap',
      ])
      drillIn()
      expect(check()).toEqual([
        'Layout: vertical',
        'Hide reference nodes and links',
        'Hide completed items',
        'Hide legend',
        'Hide minimap',
      ])
    })

    it('removes the old layout button from the top-left panel; Back still works', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
      drillIn()
      const nav = document.querySelector('.vc-graph-nav-panel')!
      expect(within(nav as HTMLElement).getByRole('button', { name: /back to all users/i })).toBeInTheDocument()
      expect(within(nav as HTMLElement).queryByRole('button', { name: /^Layout/ })).toBeNull()
      fireEvent.click(btn(/back to all users/i))
      expect(screen.getByRole('button', { name: 'Show access for User One' })).toBeInTheDocument()
    })

    it('layout toggle flips the label and pressed state; disabled in the grid', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
      expect(btn(/^Layout/)).toBeDisabled()
      drillIn()
      expect(btn('Layout: vertical')).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(btn('Layout: vertical'))
      expect(btn('Layout: horizontal')).toHaveAttribute('aria-pressed', 'false')
      expect(announcement()).toHaveTextContent('Layout changed to horizontal.')
      fireEvent.click(btn('Layout: horizontal'))
      expect(btn('Layout: vertical')).toBeInTheDocument()
      expect(announcement()).toHaveTextContent('Layout changed to vertical.')
    })

    it('minimap toggle hides/shows the minimap in grid and drill-down', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
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

    it('reference toggle removes nested items, sources, edges and the legend row; restores them', () => {
      render(<AccessGraphCanvas graph={referenceGraph()} />)
      expect(btn(/^Reference nodes/)).toBeDisabled()
      drillIn()
      const nestedLabels = ['foo', 'read', 'engr db', 'phone app']
      for (const t of nestedLabels) expect(screen.getByText(t)).toBeInTheDocument()
      expect(screen.getByRole('group', { name: /review status legend/i })).toHaveTextContent(
        'Reference Only',
      )
      expect(btn('Hide reference nodes and links')).toHaveAttribute('aria-pressed', 'true')

      fireEvent.click(btn('Hide reference nodes and links'))
      for (const t of nestedLabels) expect(screen.queryByText(t)).toBeNull()
      expect(document.querySelector('.vc-graph-card-reference')).toBeNull()
      expect(document.querySelector('.vc-graph-edge-reference')).toBeNull()
      expect(btn('Show reference nodes and links')).toHaveAttribute('aria-pressed', 'false')
      expect(announcement()).toHaveTextContent('Reference nodes and links hidden.')

      // First level, statuses and the four status legend rows are intact.
      for (const t of ['Role A', 'login', 'User One']) expect(screen.getByText(t)).toBeInTheDocument()
      expect(document.querySelectorAll('.react-flow__node .vc-graph-status-icon')).toHaveLength(2)
      const legend = screen.getByRole('group', { name: /review status legend/i })
      expect(legend).not.toHaveTextContent('Reference Only')
      expect(legend.querySelectorAll('.vc-graph-status-icon')).toHaveLength(4)

      fireEvent.click(btn('Show reference nodes and links'))
      for (const t of nestedLabels) expect(screen.getByText(t)).toBeInTheDocument()
      expect(legend).toHaveTextContent('Reference Only')
      expect(announcement()).toHaveTextContent('Reference nodes and links shown.')
    })

    it('hidden reference survives switching users and grid round trips', () => {
      render(<AccessGraphCanvas graph={twoStatusUsers()} />)
      drillIn('User One')
      fireEvent.click(btn('Hide reference nodes and links'))
      expect(screen.queryByText('read')).toBeNull()

      fireEvent.click(btn(/back to all users/i))
      // Layout/reference are disabled in the grid, but the preference is kept.
      expect(btn(/^Reference nodes/)).toBeDisabled()
      drillIn('User Two')
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
      fireEvent.click(btn('Layout: vertical'))
      fireEvent.click(btn(/back to all users/i))
      drillIn('User Two')
      expect(btn('Layout: horizontal')).toBeInTheDocument()
    })

    it('still renders a node that is both first-level and nested when reference is hidden', async () => {
      const graph = await buildFixtureGraph()
      render(<AccessGraphCanvas graph={graph} />)
      drillIn('Alice Adams')
      fireEvent.click(btn('Hide reference nodes and links'))
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
      fireEvent.click(btn('Hide reference nodes and links'))
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
        Array.from(document.querySelectorAll('.react-flow__node .vc-graph-card')).map(
          (c) => c.textContent,
        )
      const COMPLETED_ONLY = ['Role A', 'foo', 'Billing AP', 'pay', 'Payroll', 'Legacy']
      const KEPT = ['Role B', 'read', 'ERP', 'Login', 'Directory', 'Shared']

      it('is enabled and pressed by default in drill-down, disabled in the grid', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        expect(btn('Completed items (open a user to filter)')).toBeDisabled()
        drillIn()
        const completed = btn('Hide completed items')
        expect(completed).toBeEnabled()
        expect(completed).toHaveAttribute('aria-pressed', 'true')
        expect(completed).toHaveClass('vc-graph-control-active')
        for (const t of [...COMPLETED_ONLY, ...KEPT]) expect(label(t)).toBeInTheDocument()
      })

      it('hides completed cards, keeps needs-review ones and announces the count', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn()
        fireEvent.click(btn('Hide completed items'))

        for (const t of COMPLETED_ONLY) expect(label(t)).toBeNull()
        for (const t of KEPT) expect(label(t)).toBeInTheDocument()
        const hidden = btn('Show completed items (4 hidden)')
        expect(hidden).toHaveAttribute('aria-pressed', 'false')
        expect(hidden).not.toHaveClass('vc-graph-control-active')
        expect(hidden.querySelector('svg')).toHaveAttribute('data-icon', 'completedHidden')
        expect(announcement()).toHaveTextContent('Completed items hidden (4).')
        // Legend unchanged.
        const legend = screen.getByRole('group', { name: /review status legend/i })
        expect(legend.querySelectorAll('.vc-graph-status-icon')).toHaveLength(4)
        expect(legend).toHaveTextContent('Reference Only')
      })

      it('keeps a directly-held completed entitlement that is nested under a visible item as muted reference', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn()
        expect(cardOf('Shared')).toHaveAttribute('data-review-status', 'revoked')
        fireEvent.click(btn('Hide completed items'))
        const shared = cardOf('Shared')
        expect(shared).toHaveClass('vc-graph-card-reference')
        expect(shared.querySelector('.vc-graph-status-icon')).toBeNull()
        expect(shared).not.toHaveAttribute('aria-pressed')
        // The needs-review ones still carry their status.
        expect(cardOf('Role B')).toHaveAttribute('data-review-status', 'needsReview')
        expect(cardOf('Login')).toHaveAttribute('data-review-status', 'needsReview')
      })

      it('shows the completed items again, restoring the original cards', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn()
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
        fireEvent.click(btn('Hide completed items'))
        fireEvent.click(btn('Hide reference nodes and links'))
        const a = nodeLabels().sort()
        // Only the user and the needs-review first-level items remain.
        expect(a).toEqual(['Login', 'Role B', 'User One'].map((t) => expect.stringContaining(t)))
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
        fireEvent.click(btn('Hide completed items'))
        fireEvent.click(btn(/back to all users/i))
        // Grid: unfiltered, disabled, all users present.
        expect(btn('Completed items (open a user to filter)')).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Show access for User Two' })).toBeInTheDocument()
        drillIn('User Two')
        expect(btn('Show completed items (2 hidden)')).toHaveAttribute('aria-pressed', 'false')
        expect(label('Role X')).toBeNull()
        fireEvent.click(btn(/back to all users/i))
        drillIn('User One')
        expect(label('Role A')).toBeNull()
        expect(label('Role B')).toBeInTheDocument()
        fireEvent.click(btn('Show completed items (4 hidden)'))
        expect(label('Role A')).toBeInTheDocument()
      })

      it('shows the all-complete note instead of the empty-user note when everything is hidden', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn('User Two')
        expect(label('All access items are complete. Show completed items to see them.')).toBeNull()
        fireEvent.click(btn('Hide completed items'))
        const note = screen.getByText('All access items are complete. Show completed items to see them.')
        const panel = note.closest('.react-flow__panel')!
        expect(panel).toHaveClass('top')
        expect(panel).toHaveClass('center')
        expect(label('No expanded access for this user.')).toBeNull()
        expect(nodeLabels()).toEqual(['User Two'])
        fireEvent.click(btn('Show completed items (2 hidden)'))
        expect(label('All access items are complete. Show completed items to see them.')).toBeNull()
        expect(label('Role X')).toBeInTheDocument()
      })

      it('keeps the old note for a genuinely empty user, even after toggling', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn('User Three')
        expect(label('No expanded access for this user.')).toBeInTheDocument()
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
        fireEvent.click(btn('Hide completed items'))
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
        fireEvent.click(btn('Hide completed items'))
        expect(label('Role M')).toBeInTheDocument()
        expect(btn('Show completed items (0 hidden)')).toBeInTheDocument()
      })

      it('shows the hidden count in the hover hint', () => {
        render(<AccessGraphCanvas graph={completedGraph()} />)
        drillIn()
        fireEvent.click(btn('Hide completed items'))
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
      const minimap = btn('Hide minimap')
      const anchor = minimap.closest<HTMLElement>('.vc-graph-hint-anchor')!
      stubAnchorRect(anchor)
      fireEvent.mouseEnter(anchor)
      expect(screen.getByRole('tooltip')).toHaveTextContent('Hide minimap')
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

/**
 * jsdom never lays out, so `getBoundingClientRect` returns an all-zero rect and
 * the tooltip (correctly) refuses to open on a zero-size box — the real-browser
 * guard against positioning at the origin. Give THIS anchor a plausible,
 * non-zero box so the measurement path runs as it does in a browser. Scoped to
 * the element under test so it never perturbs layout-sensitive chart tests.
 */
function stubRect(el: HTMLElement): void {
  const card = (el.firstElementChild ?? el) as HTMLElement
  card.getBoundingClientRect = () =>
    ({
      x: 40,
      y: 120,
      top: 120,
      left: 40,
      right: 240,
      bottom: 184,
      width: 200,
      height: 64,
      toJSON: () => ({}),
    }) as DOMRect
}

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
