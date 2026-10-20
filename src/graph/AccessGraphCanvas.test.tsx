import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import { statusGraph } from '../test/reviewStatusFixture'
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
