import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import type {
  AccessMatrixRowVM,
  CampaignVM,
  ReviewItemVM,
} from '../sailpoint/types'
import type { AccessMatrixState } from '../state/useAccessMatrix'
import { CampaignDashboard } from './CampaignDashboard'

/** A minimal AccessMatrixState for the composition-count cards. */
function matrixState(
  overrides: Partial<AccessMatrixState> = {},
): AccessMatrixState {
  return {
    status: 'ready',
    rows: [],
    graph: { nodes: [], edges: [] },
    unresolvedCount: 0,
    error: null,
    reload: vi.fn(),
    ...overrides,
  }
}

function matrixRow(overrides: Partial<AccessMatrixRowVM>): AccessMatrixRowVM {
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

const campaign: CampaignVM = {
  id: 'c1',
  name: 'Quarterly team access review',
  description: 'Confirm your team has the right access.',
  phase: 'inProgress',
  decisionsMade: 1,
  decisionsTotal: 3,
  due: '2026-02-01T00:00:00Z',
  signed: null,
  commentRequirement: 'revokeOnly',
}

function reviewItem(overrides: Partial<ReviewItemVM>): ReviewItemVM {
  return {
    id: 'r',
    identityId: 'id-r',
    completed: false,
    decision: null,
    reassigned: false,
    comments: null,
    personName: 'P',
    accessName: 'A',
    accessKind: 'entitlement',
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

describe('CampaignDashboard', () => {
  const now = new Date('2026-01-10T00:00:00Z')

  const items: ReviewItemVM[] = [
    reviewItem({ id: '1', completed: true, decision: 'APPROVE' }),
    reviewItem({ id: '2', aiRecommendation: 'DENY', isPrivileged: true }),
    reviewItem({ id: '3' }),
  ]

  it('renders charts, metrics, and a guided call to action', () => {
    render(
      <CampaignDashboard
        campaign={campaign}
        items={items}
        onStartReviewing={vi.fn()}
        now={now}
      />,
    )

    // Charts present (via their accessible figure titles).
    expect(screen.getByText('Your progress')).toBeInTheDocument()
    expect(screen.getByText('Your decisions so far')).toBeInTheDocument()
    expect(screen.getByText('What needs your attention')).toBeInTheDocument()
    expect(screen.getByText('Time left')).toBeInTheDocument()

    // Guidance points the user at the high-priority item (1 item needs a close look).
    expect(
      screen.getByText(/we suggest starting with the 1 item that needs a close look/i),
    ).toBeInTheDocument()
  })

  it('shows the reassigned count as its own metric card', () => {
    const mixed: ReviewItemVM[] = [
      reviewItem({ id: '1', completed: true, decision: 'APPROVE' }),
      reviewItem({ id: '2', completed: true, decision: 'REVOKE' }),
      reviewItem({ id: '3', reassigned: true }),
      reviewItem({ id: '4' }),
    ]
    render(
      <CampaignDashboard
        campaign={campaign}
        items={mixed}
        onStartReviewing={vi.fn()}
        now={now}
      />,
    )
    const reassignedCard = screen.getByText('Reassigned').closest('.vc-metric')
    expect(reassignedCard).not.toBeNull()
    expect(reassignedCard).toHaveTextContent('1')
    // The decision chart summary covers the third outcome too.
    expect(
      screen.getByText(/1 kept, 1 removed, 1 reassigned\./i),
    ).toBeInTheDocument()
  })

  it('fires the start-reviewing callback', async () => {
    const onStart = vi.fn()
    render(
      <CampaignDashboard
        campaign={campaign}
        items={items}
        onStartReviewing={onStart}
        now={now}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: /continue reviewing/i }),
    )
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('does not render the access-count cards without a matrix prop', () => {
    render(
      <CampaignDashboard
        campaign={campaign}
        items={items}
        onStartReviewing={vi.fn()}
        now={now}
      />,
    )
    expect(screen.queryByText('Users')).not.toBeInTheDocument()
    expect(screen.queryByText('Access items')).not.toBeInTheDocument()
    expect(screen.queryByText('Sources')).not.toBeInTheDocument()
  })

  it('shows a placeholder on the access-count cards while the matrix resolves', () => {
    render(
      <CampaignDashboard
        campaign={campaign}
        items={items}
        matrix={matrixState({ status: 'loading' })}
        onStartReviewing={vi.fn()}
        now={now}
      />,
    )
    const usersCard = screen.getByText('Users').closest('.vc-metric')
    expect(usersCard).toHaveTextContent('—')
    expect(screen.getByText('Access items').closest('.vc-metric')).toHaveTextContent('—')
    expect(screen.getByText('Sources').closest('.vc-metric')).toHaveTextContent('—')
  })

  it('shows distinct user / access-item / source counts from the expanded matrix', () => {
    // Two users; 3 distinct leaf entitlements; 2 distinct sources.
    const graph = deriveAccessGraph([
      matrixRow({ id: '1', userId: 'u1', user: 'User One', role: 'Role A', roleId: 'ra', accessProfile: 'foo', accessProfileId: 'af', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
      matrixRow({ id: '2', userId: 'u1', user: 'User One', entitlement: 'call', entitlementId: 'e2', source: 'phone app', sourceId: 's2' }),
      matrixRow({ id: '3', userId: 'u2', user: 'User Two', accessProfile: 'bar', accessProfileId: 'ab', entitlement: 'write', entitlementId: 'e3', source: 'engr db', sourceId: 's1' }),
    ])
    render(
      <CampaignDashboard
        campaign={campaign}
        items={items}
        matrix={matrixState({ status: 'ready', graph })}
        onStartReviewing={vi.fn()}
        now={now}
      />,
    )
    expect(screen.getByText('Users').closest('.vc-metric')).toHaveTextContent('2')
    expect(screen.getByText('Access items').closest('.vc-metric')).toHaveTextContent('3')
    expect(screen.getByText('Sources').closest('.vc-metric')).toHaveTextContent('2')
  })

  it('shows a done message and hides the CTA when everything is decided', () => {
    const done = [reviewItem({ id: '1', completed: true, decision: 'APPROVE' })]
    render(
      <CampaignDashboard
        campaign={{ ...campaign, decisionsMade: 1, decisionsTotal: 1 }}
        items={done}
        onStartReviewing={vi.fn()}
        now={now}
      />,
    )
    expect(screen.getByText(/made a decision on everything/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reviewing/i })).not.toBeInTheDocument()
  })
})
