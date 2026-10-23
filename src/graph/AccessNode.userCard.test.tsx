import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import type { AccessGraphData } from '../sailpoint/types'
import { AccessGraphCanvas } from './AccessGraphCanvas'

// jsdom cannot drive React Flow's d3-zoom, so clicks are fired on the cards'
// own React handlers. These assert the USER card's extra info lines (title,
// department, location / country) and the inactive strike-through, in both the
// grid overview and a user's drill-down.

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

/** One active user with full identity detail, holding one entitlement. */
function activeUser(overrides: Partial<StatusRow> = {}): AccessGraphData {
  return statusGraph([
    row({
      id: '1',
      entitlement: 'login',
      entitlementId: 'e2',
      source: 'phone app',
      sourceId: 's2',
      reviewStatus: 'approved',
      accessItemKind: 'entitlement',
      accessItemId: 'e2',
      accessItemName: 'login',
      userTitle: 'Staff Engineer',
      userDepartment: 'Platform',
      userLocation: 'Austin',
      userCountry: 'USA',
      userLifecycleState: 'active',
      ...overrides,
    }),
  ])
}

/** The user card in whichever mode is current (grid or drill-down). */
const userCard = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node .vc-graph-card.kind-user'))[0]
const label = (el: HTMLElement) => el.querySelector('.vc-graph-card-label')!
const infoLines = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('.vc-graph-card-info')).map((n) => n.textContent)
const drillIn = (user = 'User One') =>
  fireEvent.click(screen.getByRole('button', { name: `Show access for ${user}` }))

describe('AccessNode user card', () => {
  it('shows title, department and a combined location / country line in the grid', () => {
    render(<AccessGraphCanvas graph={activeUser()} />)
    const grid = userCard()
    expect(label(grid)).toHaveTextContent('User One')
    expect(infoLines(grid)).toEqual(['Staff Engineer', 'Platform', 'Austin / USA'])
  })

  it('shows the same info lines on the user node in drill-down', () => {
    render(<AccessGraphCanvas graph={activeUser()} />)
    drillIn()
    const node = userCard()
    expect(label(node)).toHaveTextContent('User One')
    expect(infoLines(node)).toEqual(['Staff Engineer', 'Platform', 'Austin / USA'])
  })

  it('omits an info line that is not set and joins only the present location/country', () => {
    render(
      <AccessGraphCanvas
        graph={activeUser({ userTitle: '', userCountry: '' })}
      />,
    )
    // Title gone; the location/country line is just the location (no " / ").
    expect(infoLines(userCard())).toEqual(['Platform', 'Austin'])
  })

  it('renders no info lines when the user has no extra detail', () => {
    render(
      <AccessGraphCanvas
        graph={activeUser({
          userTitle: '',
          userDepartment: '',
          userLocation: '',
          userCountry: '',
        })}
      />,
    )
    expect(infoLines(userCard())).toEqual([])
  })

  it('does not strike the name for an active identity', () => {
    render(<AccessGraphCanvas graph={activeUser()} />)
    expect(label(userCard())).not.toHaveClass('vc-graph-card-label-inactive')
  })

  it('strikes the name when the lifecycle state is not active', () => {
    render(<AccessGraphCanvas graph={activeUser({ userLifecycleState: 'inactive' })} />)
    expect(label(userCard())).toHaveClass('vc-graph-card-label-inactive')
  })

  it('treats the inactive check case-insensitively (ACTIVE is not struck)', () => {
    render(<AccessGraphCanvas graph={activeUser({ userLifecycleState: 'ACTIVE' })} />)
    expect(label(userCard())).not.toHaveClass('vc-graph-card-label-inactive')
  })

  it('does not strike the name when the lifecycle state is unknown', () => {
    render(<AccessGraphCanvas graph={activeUser({ userLifecycleState: '' })} />)
    expect(label(userCard())).not.toHaveClass('vc-graph-card-label-inactive')
  })

  it('ignores the identity state for the strike (lifecycle active, identity unregistered)', () => {
    // Matches the real case: lifecycleState "active" but identityState
    // "UNREGISTERED" must NOT strike the name.
    render(
      <AccessGraphCanvas
        graph={activeUser({ userLifecycleState: 'active', userIdentityState: 'UNREGISTERED' })}
      />,
    )
    expect(label(userCard())).not.toHaveClass('vc-graph-card-label-inactive')
  })
})

describe('AccessNode user card manager badge + kind icon placement', () => {
  const managerMark = (el: HTMLElement) =>
    el.querySelector('.vc-graph-manager-mark')
  const userKindIcon = (el: HTMLElement) =>
    el.querySelector('.vc-graph-card-kind-icon.kind-user')

  it('renders the user kind icon on the user card (moved to the bottom-left corner)', () => {
    render(<AccessGraphCanvas graph={activeUser()} />)
    const card = userCard()
    const icon = userKindIcon(card)
    expect(icon).not.toBeNull()
    // Anchored, not in normal flow (mirrors the status-icon corner convention).
    expect(icon).toHaveAttribute('data-kind', 'user')
  })

  it('shows the manager badge when the user is a manager', () => {
    render(<AccessGraphCanvas graph={activeUser({ userIsManager: 'Yes' })} />)
    const badge = managerMark(userCard())
    expect(badge).not.toBeNull()
    expect(badge).toHaveAttribute('role', 'img')
    expect(badge).toHaveAttribute('aria-label', 'Manager')
  })

  it('shows the manager badge on the user node in drill-down too', () => {
    render(<AccessGraphCanvas graph={activeUser({ userIsManager: 'Yes' })} />)
    drillIn()
    expect(managerMark(userCard())).not.toBeNull()
  })

  it('omits the manager badge when the user is not a manager', () => {
    render(<AccessGraphCanvas graph={activeUser({ userIsManager: 'No' })} />)
    expect(managerMark(userCard())).toBeNull()
  })

  it('omits the manager badge when manager status is unknown', () => {
    render(<AccessGraphCanvas graph={activeUser({ userIsManager: '' })} />)
    expect(managerMark(userCard())).toBeNull()
  })
})
