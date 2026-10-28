import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import { applyReviewStatus } from '../domain/reviewOverlay'
import { shallowRow } from '../sailpoint/accessMatrix'
import { emptyResolvedIdentity } from '../sailpoint/identities'
import type { AccessMatrixRowVM, ReviewItemVM } from '../sailpoint/types'
import type { UserDetailState } from '../state/useAccessMatrix'
import { AccessGraphCanvas } from './AccessGraphCanvas'

function item(overrides: Partial<ReviewItemVM>): ReviewItemVM {
  return {
    id: 'r1',
    identityId: 'u1',
    completed: false,
    decision: null,
    reassigned: false,
    comments: null,
    personName: 'User One',
    accessName: 'access',
    accessKind: 'access',
    accessId: null,
    accessDescription: null,
    sourceName: null,
    isNewAccess: false,
    isPrivileged: false,
    isCloudGoverned: false,
    dataImpact: null,
    usageDays: null,
    aiRecommendation: null,
    revocable: true,
    ...overrides,
  }
}

function row(overrides: Partial<AccessMatrixRowVM>): AccessMatrixRowVM {
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

const roleItem = item({ id: 'rev-role', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' })

/** The overview-grid graph: user + the role they directly hold, nothing
 * deeper — exactly what `useAccessMatrix` builds with zero API calls. Run
 * through the real `applyReviewStatus` overlay so the first-level role edge
 * carries a status (an unreviewed item is "needsReview"), matching the live
 * graph `AccessGraphCanvas` actually receives — reference content with no
 * status is hidden by default (`withoutReference`), so without this the role
 * card would not appear until "Show reference" is toggled on. */
function shallowGraph() {
  return applyReviewStatus(deriveAccessGraph([shallowRow(roleItem)]), [roleItem])
}

/** This user's full composition once lazily resolved: Role A expands into an
 * access profile, an entitlement and a source. Structural only — the real
 * `useAccessMatrix` stores `deriveAccessGraph(rows)` with no review status.
 * Status is copied from the shallow graph at display time. */
function structuralDeepGraph() {
  return deriveAccessGraph([
    row({
      id: 'rev-role',
      role: 'Role A',
      roleId: 'role-a',
      accessProfile: 'foo',
      accessProfileId: 'ap-foo',
      entitlement: 'read',
      entitlementId: 'e1',
      source: 'engr db',
      sourceId: 's1',
      accessItemKind: 'role',
      accessItemId: 'role-a',
      accessItemName: 'Role A',
    }),
  ])
}

/** The same composition with live review status, for the non-lazy canvas. */
function deepGraph() {
  return applyReviewStatus(structuralDeepGraph(), [roleItem])
}

describe('AccessGraphCanvas lazy mode (userDetails + onUserSelected)', () => {
  it('calls onUserSelected with the BARE identity id when a user card is drilled into', () => {
    const onUserSelected = vi.fn()
    render(
      <AccessGraphCanvas graph={shallowGraph()} userDetails={{}} onUserSelected={onUserSelected} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    expect(onUserSelected).toHaveBeenCalledExactlyOnceWith('u1')
  })

  it('shows each user card complete from the prefetched identities, before anyone is selected', () => {
    const graph = shallowGraph()
    render(
      <AccessGraphCanvas
        graph={graph}
        userDetails={{}}
        identities={{
          u1: emptyResolvedIdentity({
            identityId: 'u1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            title: 'Engineer',
            department: 'Platform',
            location: 'Austin',
            country: 'USA',
            email: 'ada@example.com',
            phone: '+1 555 0101',
            isManager: 'Yes',
            manager: 'Grace Hopper',
            lifecycleState: 'active',
            identityState: 'ACTIVE',
            attributes: [
              ['firstName', 'Ada'],
              ['FIRST NAME', 'Ada'],
              ['FIRSTNAME', 'Ada'],
              ['lastName', 'Lovelace'],
              ['LASTNAME', 'Lovelace'],
              ['jobTitle', 'Engineer'],
              ['TITLE', 'Engineer'],
              ['employeeNumber', '900'],
              ['EMPLOYEE NUMBER', '900'],
              ['startDate', '2199-01-01T00:00:00.000Z'],
              ['STARTDATE', '2199-01-01T00:00:00.000Z'],
              ['username', 'Neville.Kaufman'],
              ['types', 'Employee'],
              ['googleEmail', 'neville.kaufman@example.com'],
              ['IBMIUSERNAME', 'NKAUFMAN'],
              ['city', ''],
            ],
          }),
        }}
        onUserSelected={vi.fn()}
      />,
    )
    const card = screen.getByRole('button', { name: 'Show access for Ada Lovelace' })
    expect(card).toHaveTextContent('Engineer')
    expect(card).toHaveTextContent('Platform')
    expect(card).toHaveTextContent('Austin')
    expect(card).toHaveTextContent('USA')
    expect(screen.getByRole('img', { name: 'Manager' })).toBeInTheDocument()

    fireEvent.click(card)
    fireEvent.click(screen.getByRole('button', { name: 'Show details panel' }))
    fireEvent.click(screen.getByRole('article', { name: 'User: Ada Lovelace' }))
    const details = screen.getByRole('group', { name: 'Node details' })
    for (const [label, value] of [
      ['First name', 'Ada'],
      ['Last name', 'Lovelace'],
      ['Title', 'Engineer'],
      ['Email', 'ada@example.com'],
      ['Phone', '+1 555 0101'],
      ['Department', 'Platform'],
      ['Location', 'Austin'],
      ['Country', 'USA'],
      ['Manager', 'Grace Hopper'],
      ['Is manager', 'Yes'],
      ['Lifecycle state', 'active'],
      ['Identity state', 'ACTIVE'],
      ['Identity ID', 'u1'],
      ['Employee number', '900'],
      ['Start date', '2199-01-01T00:00:00.000Z'],
      ['Username', 'Neville.Kaufman'],
      ['Types', 'Employee'],
      ['Google email', 'neville.kaufman@example.com'],
      ['IBMIUSERNAME', 'NKAUFMAN'],
    ] as const) {
      const dt = within(details).getByText(label)
      expect(dt.nextElementSibling).toHaveTextContent(value)
    }
    expect(within(details).getByText('Attributes')).toBeInTheDocument()
    expect(within(details).queryByText('City')).not.toBeInTheDocument()
    // Named fields and their attribute aliases each appear once.
    for (const label of ['First name', 'Last name', 'Title', 'Employee number', 'Start date']) {
      expect(within(details).getAllByText(label)).toHaveLength(1)
    }
    expect(within(details).queryByText('Job title')).not.toBeInTheDocument()
    expect(within(details).queryByText('FIRSTNAME')).not.toBeInTheDocument()
    expect(within(details).queryByText('LASTNAME')).not.toBeInTheDocument()
  })

  it('shows the manager mark as soon as the identity is known, before composition finishes', () => {
    const manager = emptyResolvedIdentity({ identityId: 'u1', isManager: 'Yes' })
    const loading: UserDetailState = {
      userId: 'u1',
      status: 'loading',
      graph: { nodes: [], edges: [] },
      unresolvedCount: 0,
      error: null,
      identity: manager,
    }
    const graph = shallowGraph()
    const { rerender } = render(
      <AccessGraphCanvas graph={graph} userDetails={{}} onUserSelected={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    expect(screen.queryByRole('img', { name: 'Manager' })).not.toBeInTheDocument()

    rerender(
      <AccessGraphCanvas graph={graph} userDetails={{ u1: loading }} onUserSelected={vi.fn()} />,
    )
    // Still the shallow drill-down (composition has not finished) but the
    // pinned user card now carries the manager mark.
    expect(screen.getByText('Role A')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Manager' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /back to all users/i }))
    // The grid card keeps the mark after the identity is known.
    expect(screen.getByRole('img', { name: 'Manager' })).toBeInTheDocument()
  })

  it("shows the user's shallow first-level item immediately, before resolution completes", () => {
    render(<AccessGraphCanvas graph={shallowGraph()} userDetails={{}} onUserSelected={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    expect(screen.getByText('Role A')).toBeInTheDocument()
  })

  it('shows a loading note only once "Show reference" is toggled on, before resolution completes', () => {
    render(<AccessGraphCanvas graph={shallowGraph()} userDetails={{}} onUserSelected={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    expect(screen.queryByText(/loading this user.s full access details/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))
    expect(screen.getByText(/loading this user.s full access details/i)).toBeInTheDocument()
  })

  it('swaps in the deep graph once userDetails reports it ready, revealing reference lineage', () => {
    const ready: UserDetailState = {
      userId: 'u1',
      status: 'ready',
      graph: structuralDeepGraph(),
      unresolvedCount: 0,
      error: null,
    }
    // The SAME graph object across both renders: a campaign's overview graph
    // only changes reference on a real structural change (new/removed items),
    // never because a user's lazy resolution completed — exactly like the
    // real `useAccessMatrix` keeps `graph.nodes` stable across that.
    const graph = shallowGraph()
    const { rerender } = render(
      <AccessGraphCanvas graph={graph} userDetails={{}} onUserSelected={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))
    expect(screen.queryByText('engr db')).not.toBeInTheDocument()

    rerender(
      <AccessGraphCanvas graph={graph} userDetails={{ u1: ready }} onUserSelected={vi.fn()} />,
    )
    expect(screen.getByText('engr db')).toBeInTheDocument()
    expect(screen.queryByText(/loading this user.s full access details/i)).not.toBeInTheDocument()
  })

  it('keeps the first-level items and the completion count after the structural deep graph arrives', () => {
    // Reference stays hidden (the default). The resolved graph carries no
    // review status of its own — that is how useAccessMatrix stores it. The
    // drill-down must copy status from the shallow graph, or the hide-reference
    // filter drops every access item and the "X% (Y of Z)" falls to 0 of 0.
    const graph = shallowGraph()
    const { rerender } = render(
      <AccessGraphCanvas graph={graph} userDetails={{}} onUserSelected={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    expect(screen.getByText('Role A')).toBeInTheDocument()
    expect(screen.getByText('0% (0 of 1)')).toBeInTheDocument()

    const ready: UserDetailState = {
      userId: 'u1',
      status: 'ready',
      graph: structuralDeepGraph(),
      unresolvedCount: 0,
      error: null,
    }
    rerender(
      <AccessGraphCanvas graph={graph} userDetails={{ u1: ready }} onUserSelected={vi.fn()} />,
    )
    expect(screen.getByText('Role A')).toBeInTheDocument()
    expect(screen.getByText('0% (0 of 1)')).toBeInTheDocument()
    // Nested lineage stays hidden until reference is shown.
    expect(screen.queryByText('engr db')).not.toBeInTheDocument()
  })

  it('shows a retry affordance on error, which re-calls onUserSelected for the same user', () => {
    const onUserSelected = vi.fn()
    const errored: Record<string, UserDetailState> = {
      u1: { userId: 'u1', status: 'error', graph: { nodes: [], edges: [] }, unresolvedCount: 0, error: 'boom' },
    }
    render(
      <AccessGraphCanvas graph={shallowGraph()} userDetails={errored} onUserSelected={onUserSelected} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))
    onUserSelected.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onUserSelected).toHaveBeenCalledExactlyOnceWith('u1')
  })

  it('omitting userDetails/onUserSelected keeps the original non-lazy behavior (graph already fully composed)', () => {
    render(<AccessGraphCanvas graph={deepGraph()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))
    // No loading/retry note: non-lazy mode has nothing to resolve.
    expect(screen.queryByText(/loading this user.s full access details/i)).not.toBeInTheDocument()
    expect(screen.getByText('engr db')).toBeInTheDocument()
  })
})
