import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildFixtureGraph, statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import type { AccessGraphData } from '../sailpoint/types'
import { AccessGraphCanvas } from './AccessGraphCanvas'

// The detail fly-out is a plain overlay panel (no layout / viewport input), so
// this asserts the DOM: the control toggle, the per-kind field set, the
// select-a-node prompt, and that pane clicks / filters drop a stale target.
// jsdom cannot drive React Flow's d3-zoom pointer sequence, so clicks are fired
// on the cards' own React handlers (as the other canvas tests do).

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

/** role-a{ap-foo{e1}} needsReview -> engr db; login approved held directly. */
function graph(): AccessGraphData {
  return statusGraph([
    row({
      id: '1',
      role: 'Role A',
      roleId: 'role-a',
      roleDescription: 'Role A description',
      accessProfile: 'foo',
      accessProfileId: 'ap-foo',
      entitlement: 'read',
      entitlementId: 'e1',
      source: 'engr db',
      sourceId: 's1',
      reviewStatus: 'needsReview',
      accessItemKind: 'role',
      accessItemId: 'role-a',
      accessItemName: 'Role A',
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
      accessItemName: 'login',
    }),
  ])
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name })
// Scope to the graph's node cards: once the detail panel echoes a node's label,
// a bare getByText would match both the card and the panel.
const card = (label: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node .vc-graph-card')).find(
    (el) => el.querySelector('.vc-graph-card-label')?.textContent === label,
  )!
const drillIn = (user = 'User One') => fireEvent.click(btn(`Show access for ${user}`))
const panel = () => screen.queryByRole('group', { name: 'Node details' })
const openDetail = () => fireEvent.click(btn('Show details panel'))

describe('AccessGraphCanvas node detail panel', () => {
  it('is hidden by default and the control toggles it on and off', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    expect(panel()).not.toBeInTheDocument()

    openDetail()
    const toggle = () => btn(/^(Show|Hide) details panel$/)
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(panel()).toBeInTheDocument()

    fireEvent.click(toggle())
    expect(panel()).not.toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
  })

  it('invites the reviewer to pick a node when nothing is selected', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    openDetail()
    expect(panel()).toHaveTextContent(/select a node/i)
  })

  it('renders the per-kind glyph immediately before the kind badge', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    openDetail()
    fireEvent.click(card('Role A'))

    const details = panel()!
    const row = details.querySelector<HTMLElement>('.vc-graph-detail-kind-row')!
    const icon = row.querySelector('.vc-graph-detail-kind-icon')!
    const badge = row.querySelector('.vc-graph-detail-kind')!
    // Both present, the icon tagged with the node's kind, and the icon comes
    // first in document order (before the badge).
    expect(icon).toHaveAttribute('data-kind', 'role')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(badge).toHaveTextContent('Role')
    expect(icon.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the kind, label, description and review status of a first-level item', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    openDetail()
    fireEvent.click(card('Role A'))

    const details = panel()!
    expect(within(details).getByText('Role')).toBeInTheDocument()
    expect(within(details).getByText('Role A')).toBeInTheDocument()
    expect(within(details).getByText('Description')).toBeInTheDocument()
    // The review status now sits directly under the name as an icon + caption,
    // carrying its per-status class, rather than a "Review status" field.
    const statusLine = details.querySelector('.vc-graph-detail-status')
    expect(statusLine).not.toBeNull()
    expect(statusLine).toHaveClass('vc-graph-detail-status-needsReview')
    expect(statusLine).toHaveTextContent('Needs review')
    // A horizontal rule separates the status from the attributes below it.
    expect(details.querySelector('.vc-graph-detail-sep')).not.toBeNull()
  })

  it('shows details for a reference-only deeper node and flags it as reference', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    openDetail()
    // `read` is a deeper entitlement nested under the role — reference only.
    fireEvent.click(card('read'))

    const details = panel()!
    expect(within(details).getByText('Entitlement')).toBeInTheDocument()
    expect(within(details).getByText('read')).toBeInTheDocument()
    expect(details).toHaveTextContent(/reference only/i)
    // A reference node is not reviewed, so no status line (and no separator).
    expect(details.querySelector('.vc-graph-detail-status')).toBeNull()
    expect(details.querySelector('.vc-graph-detail-sep')).toBeNull()
  })

  it('shows the source node as its own kind', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    openDetail()
    fireEvent.click(card('engr db'))

    const details = panel()!
    expect(within(details).getByText('Source')).toBeInTheDocument()
    expect(within(details).getByText('engr db')).toBeInTheDocument()
  })

  it('shows the user node with department and location fields', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    openDetail()
    // The user node label is the drilled-in user.
    fireEvent.click(card('User One'))

    const details = panel()!
    expect(within(details).getByText('User')).toBeInTheDocument()
    expect(within(details).getByText('Department')).toBeInTheDocument()
    expect(within(details).getByText('Location')).toBeInTheDocument()
    // A user carries no description field.
    expect(within(details).queryByText('Description')).not.toBeInTheDocument()
  })

  it('clicking the same node again clears the detail target', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    openDetail()
    fireEvent.click(card('Role A'))
    expect(panel()).toHaveTextContent('Role A')

    fireEvent.click(card('Role A'))
    expect(panel()).toHaveTextContent(/select a node/i)
  })

  it('a pane click clears the detail target', () => {
    const { container } = render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    openDetail()
    fireEvent.click(card('login'))
    expect(panel()).toHaveTextContent('login')

    fireEvent.click(container.querySelector('.react-flow__pane')!)
    expect(panel()).toHaveTextContent(/select a node/i)
  })

  it('the close control hides the whole panel', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    openDetail()
    fireEvent.click(card('Role A'))

    fireEvent.click(within(panel()!).getByRole('button', { name: 'Hide details' }))
    expect(panel()).not.toBeInTheDocument()
    expect(btn('Show details panel')).toHaveAttribute('aria-pressed', 'false')
  })

  it('drops a detail target whose node the reference filter hides', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    openDetail()
    // Select a reference-only (deeper) node, then hide reference content.
    fireEvent.click(card('read'))
    expect(panel()).toHaveTextContent('read')

    fireEvent.click(btn('Hide reference nodes and links'))
    expect(panel()).toHaveTextContent(/select a node/i)
  })

  it('drops the detail target when returning to the grid', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    openDetail()
    fireEvent.click(card('Role A'))
    expect(panel()).toHaveTextContent('Role A')

    fireEvent.keyDown(window, { key: 'Escape' }) // nothing selected-for-edges? Role A is, so first clears selection
    // Role A was also the edge-selection; Escape cleared that first. Esc again → grid.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText(/showing .* users/i)).toBeInTheDocument()
    // Panel stays open (toggle persists) but shows the prompt again in the grid.
    expect(panel()).toHaveTextContent(/select a node/i)
  })

  it('shows the enriched identity fields for a user node', async () => {
    // The fixture resolver returns a full identity (email, manager, etc.), so
    // the user node carries the richer detail the panel renders.
    render(<AccessGraphCanvas graph={await buildFixtureGraph()} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show access for Alice Adams' })).toBeInTheDocument(),
    )
    drillIn('Alice Adams')
    openDetail()
    fireEvent.click(card('Alice Adams'))

    const details = panel()!
    expect(within(details).getByText('User')).toBeInTheDocument()
    // The org-graph-style identity fields render with their values.
    for (const [label, value] of [
      ['Title', 'Staff Engineer'],
      ['Email', 'alice.adams@example.com'],
      ['Phone', '+1 555 0100'],
      ['Department', 'Finance'],
      ['Location', 'Austin'],
      ['Country', 'USA'],
      ['Manager', 'Carol Chen'],
      ['Is manager', 'Yes'],
      ['Lifecycle state', 'active'],
      ['Identity state', 'ACTIVE'],
      ['Identity ID', 'u-a'],
    ] as const) {
      const dt = within(details).getByText(label)
      expect(dt.nextElementSibling).toHaveTextContent(value)
    }
  })
})
