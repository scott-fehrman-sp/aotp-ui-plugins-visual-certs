import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import { applyReviewStatus } from '../domain/reviewOverlay'
import { buildAccessScene } from '../graph/buildAccessScene'
import { shallowRow } from '../sailpoint/accessMatrix'
import type { AccessMatrixRowVM, ReviewItemVM } from '../sailpoint/types'
import type { AccessMatrixState, UserDetailState } from '../state/useAccessMatrix'
import { AccessMatrixView } from './AccessMatrixView'

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
    accessKind: 'role',
    accessId: 'role-a',
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

/** User One, directly holding Role A (one review item). */
const roleItem = item({ id: '1', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' })

/** The overview-grid graph `useAccessMatrix` would build for `roleItem`: zero
 * role/AP/entitlement/source API calls, just the user + their held role. */
function overviewGraph() {
  return applyReviewStatus(deriveAccessGraph([shallowRow(roleItem)]), [roleItem])
}

/** Role A's full composition once lazily resolved for User One. */
function deepGraph() {
  return applyReviewStatus(
    deriveAccessGraph([
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
        accessItemKind: 'role',
        accessItemId: 'role-a',
        accessItemName: 'Role A',
      }),
    ]),
    [roleItem],
  )
}

function matrixState(overrides: Partial<AccessMatrixState> = {}): AccessMatrixState {
  return {
    status: 'ready',
    graph: overviewGraph(),
    userDetails: {},
    identities: {},
    resolveUser: vi.fn(),
    ...overrides,
  }
}

describe('AccessMatrixView', () => {
  afterEach(() => {
    document.getElementById('vc-title-nav')?.remove()
    document.getElementById('vc-header-slot')?.remove()
  })

  it('renders the graph surface with the preserved chrome', () => {
    const matrix = matrixState()
    const { container } = render(
      <AccessMatrixView campaignName="Q3 review" matrix={matrix} onBack={vi.fn()} />,
    )

    // Preserved chrome: the back button and the title.
    expect(
      screen.getByRole('button', { name: '← Overview' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'All access paths' }),
    ).toBeInTheDocument()

    // The React Flow surface mounts (DOM only — test.css is false so no layout).
    expect(container.querySelector('.react-flow')).not.toBeNull()

    // The overview graph carries the user and their directly-held role.
    const scene = buildAccessScene(matrix.graph, 'LR')
    const labels = scene.nodes.map((node) => node.data.label)
    expect(labels).toContain('User One')
  })

  it('defaults to the user grid, drills in, and calls resolveUser for that user', () => {
    const resolveUser = vi.fn()
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={matrixState({ resolveUser })}
        onBack={vi.fn()}
      />,
    )
    // Default (grid) mode: only the user card shows; the role node does not.
    expect(
      screen.getByRole('button', { name: 'Show access for User One' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Role A')).not.toBeInTheDocument()

    // Drilling into the user reveals that user's directly-held role — which
    // is "selecting them for processing": resolveUser is called for them.
    fireEvent.click(
      screen.getByRole('button', { name: 'Show access for User One' }),
    )
    expect(screen.getByText('Role A')).toBeInTheDocument()
    expect(resolveUser).toHaveBeenCalledExactlyOnceWith('u1')
  })

  it("shows the resolved user's full composition once resolveUser's result lands in userDetails", () => {
    // The SAME graph object across both renders: the overview graph only
    // changes reference on a real structural change, never because a user's
    // lazy resolution completed (mirrors the real useAccessMatrix).
    const graph = overviewGraph()
    const { rerender } = render(
      <AccessMatrixView campaignName="Q3 review" matrix={matrixState({ graph })} onBack={vi.fn()} />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Show access for User One' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))
    expect(screen.queryByText('engr db')).not.toBeInTheDocument()

    const ready: UserDetailState = {
      userId: 'u1',
      status: 'ready',
      graph: deepGraph(),
      unresolvedCount: 0,
      error: null,
    }
    rerender(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={matrixState({ graph, userDetails: { u1: ready } })}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByText('engr db')).toBeInTheDocument()
  })

  it('puts "Back to all users" in the title bar next to "Back to overview", outside the graph', () => {
    const titleNav = document.createElement('div')
    titleNav.id = 'vc-title-nav'
    document.body.appendChild(titleNav)
    const { container } = render(
      <AccessMatrixView campaignName="Q3 review" matrix={matrixState()} onBack={vi.fn()} />,
    )
    const nav = screen.getByRole('navigation', { name: /access map navigation/i })
    expect(titleNav).toContainElement(nav)
    expect(container.querySelector('section.vc-matrix-view')).not.toContainElement(nav)

    // Grid mode: only "Back to overview" is there; there is no per-user back.
    expect(screen.queryByRole('button', { name: '← All Users' })).toBeNull()
    expect(
      within(nav).getByRole('button', { name: '← Overview' }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))

    // Drill-down: both back controls live together in the title bar...
    const backToUsers = within(nav).getByRole('button', { name: '← All Users' })
    expect(backToUsers).toBeInTheDocument()
    const labels = within(nav)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim())
    expect(labels).toEqual(['← Overview', '← All Users'])

    // ...and NOT inside the graph canvas (no top-left nav panel either).
    expect(container.querySelector('.react-flow')!.contains(backToUsers)).toBe(false)
    expect(container.querySelector('.vc-graph-nav-panel')).toBeNull()
  })

  it('stacks a back link for each level, so a drilled-in user can jump to any earlier screen', () => {
    const onBack = vi.fn()
    const onBackToReviews = vi.fn()
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={matrixState()}
        onBack={onBack}
        onBackToReviews={onBackToReviews}
      />,
    )
    const labels = () =>
      within(screen.getByRole('navigation', { name: /access map navigation/i }))
        .getAllByRole('button')
        .map((button) => button.textContent?.trim())

    // User grid: the two screens above this one.
    expect(labels()).toEqual(['← All Reviews', '← Overview'])

    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    // User graph: the grid is added, and the earlier stops stay.
    expect(labels()).toEqual([
      '← All Reviews',
      '← Overview',
      '← All Users',
    ])

    fireEvent.click(screen.getByRole('button', { name: '← All Reviews' }))
    expect(onBackToReviews).toHaveBeenCalledOnce()
    expect(onBack).not.toHaveBeenCalled()
  })

  it('"Back to all users" in the nav row returns to the user grid', () => {
    render(
      <AccessMatrixView campaignName="Q3 review" matrix={matrixState()} onBack={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    expect(screen.getByText('Role A')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '← All Users' }))

    // Back on the grid: the user card is back, lineage is gone, and the
    // per-user back control has left the nav row.
    expect(
      screen.getByRole('button', { name: 'Show access for User One' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Role A')).toBeNull()
    expect(screen.queryByRole('button', { name: '← All Users' })).toBeNull()
  })

  it('leaves "Back to overview" working in drill-down too', async () => {
    const onBack = vi.fn()
    render(
      <AccessMatrixView campaignName="Q3 review" matrix={matrixState()} onBack={onBack} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    await userEvent.click(screen.getByRole('button', { name: '← Overview' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('keeps the "All access paths" heading only as a visually hidden heading', () => {
    const { container } = render(
      <AccessMatrixView campaignName="Q3 review" matrix={matrixState()} onBack={vi.fn()} />,
    )
    // Still in the accessibility tree for screen readers...
    const heading = screen.getByRole('heading', { name: 'All access paths' })
    // ...but it carries the visually-hidden class, not the old visible heading
    // styles, so it takes no vertical space above the graph.
    expect(heading).toHaveClass('vc-matrix-sr-heading')
    expect(container.querySelector('.vc-matrix-head')).toBeNull()
    expect(container.querySelector('.vc-matrix-title')).toBeNull()
  })

  it('marks the section so the page shell can hand it the remaining height', () => {
    const { container } = render(
      <AccessMatrixView campaignName="Q3 review" matrix={matrixState()} onBack={vi.fn()} />,
    )
    const section = container.querySelector('section.vc-matrix-view')
    expect(section).not.toBeNull()
    // The canvas is a direct child so the flex column can size it.
    expect(section!.querySelector(':scope > .vc-graph-wrap')).not.toBeNull()
  })

  it('calls onBack when the back button is clicked', async () => {
    const onBack = vi.fn()
    render(
      <AccessMatrixView campaignName="Q3 review" matrix={matrixState()} onBack={onBack} />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: '← Overview' }),
    )
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('shows the loading state while items have not loaded yet', () => {
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={matrixState({ status: 'idle', graph: { nodes: [], edges: [] } })}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByText('Building the access map…')).toBeInTheDocument()
  })

  it('shows the empty state when ready with zero users', () => {
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={matrixState({ graph: { nodes: [], edges: [] } })}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByText('No access to map')).toBeInTheDocument()
  })

  it('portals a per-user "unresolved" notice into the app header slot once that user resolves with soft-degraded rows', () => {
    // The real App renders this slot in its header; the view portals the notice
    // into it so it sits inline with the "Access Review" title, not above the
    // graph. Provide the slot here to mirror that structure.
    const headerSlot = document.createElement('div')
    headerSlot.id = 'vc-header-slot'
    document.body.appendChild(headerSlot)

    const ready: UserDetailState = {
      userId: 'u1',
      status: 'ready',
      graph: deepGraph(),
      unresolvedCount: 1,
      error: null,
    }
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={matrixState({ userDetails: { u1: ready } })}
        onBack={vi.fn()}
      />,
    )
    // Not shown in the grid — only once a user is drilled into.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/1 access path/i)
    expect(banner).toHaveTextContent(/unresolved/i)
    // It lands in the header slot, not inside the matrix view / above the graph.
    expect(headerSlot).toContainElement(banner)

    // Leaving the drill-down drops the notice.
    fireEvent.click(screen.getByRole('button', { name: '← All Users' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
