import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CampaignVM, ReviewItemVM } from '../sailpoint/types'
import { CampaignDashboard } from './CampaignDashboard'

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

  it('keeps reassigned in the decision chart and does not give it its own card', () => {
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
    const labels = [...document.querySelectorAll('.vc-metric-label')].map(
      (el) => el.textContent,
    )
    expect(labels).not.toContain('Reassigned')
    expect(
      screen.getByText(/1 kept, 1 removed, 1 reassigned\./i),
    ).toBeInTheDocument()
  })

  it('offers View Users and a disabled View Access Items button', () => {
    render(
      <CampaignDashboard
        campaign={campaign}
        items={items}
        onStartReviewing={vi.fn()}
        onViewMatrix={vi.fn()}
        now={now}
      />,
    )
    expect(screen.getByRole('button', { name: 'View Users' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'View Access Items' })).toBeDisabled()
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

  it('never shows a Sources metric: that requires the role/AP/entitlement/source APIs', () => {
    render(
      <CampaignDashboard
        campaign={campaign}
        items={items}
        onStartReviewing={vi.fn()}
        now={now}
      />,
    )
    expect(screen.queryByText('Sources')).not.toBeInTheDocument()
  })

  it('puts Users first and counts them as distinct identities on the loaded items', () => {
    const { container } = render(
      <CampaignDashboard
        campaign={campaign}
        items={[
          reviewItem({ id: '1', identityId: 'u1' }),
          reviewItem({ id: '2', identityId: 'u1' }),
          reviewItem({ id: '3', identityId: 'u2' }),
        ]}
        onStartReviewing={vi.fn()}
        now={now}
      />,
    )
    const labels = [...container.querySelectorAll('.vc-metric-label')].map(
      (el) => el.textContent,
    )
    expect(labels[0]).toBe('Users')
    expect(labels).toEqual([
      'Users',
      'Access items',
      'Total Decisions',
      'Still to review',
      'Reviewed',
      'Kept',
      'Removed',
    ])
    // Three review items, two identities: a user with several items counts once.
    // These three rows are the same unnamed entitlement, so it is one access item.
    expect(screen.getByText('Total Decisions').closest('.vc-metric')).toHaveTextContent('3')
    expect(screen.getByText('Users').closest('.vc-metric')).toHaveTextContent('2')
    const access = screen.getByText('Access items').closest('.vc-metric')
    expect(access).toHaveTextContent('1')
    expect(access).toHaveTextContent('Roles (0), Access Profiles (0), Entitlements (1)')
  })

  it('counts a shared role once and lists roles, access profiles, and entitlements', () => {
    render(
      <CampaignDashboard
        campaign={campaign}
        items={[
          reviewItem({ id: '1', identityId: 'u1', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' }),
          reviewItem({ id: '2', identityId: 'u2', accessKind: 'role', accessId: 'role-a', accessName: 'Role A' }),
          reviewItem({ id: '3', identityId: 'u1', accessKind: 'accessProfile', accessId: 'ap-1', accessName: 'Billing' }),
          reviewItem({ id: '4', identityId: 'u1', accessKind: 'entitlement', accessId: 'e-1', accessName: 'Login' }),
          reviewItem({ id: '5', identityId: 'u2', accessKind: 'entitlement', accessId: 'e-2', accessName: 'Admin' }),
        ]}
        onStartReviewing={vi.fn()}
        now={now}
      />,
    )
    const access = screen.getByText('Access items').closest('.vc-metric')
    expect(access).toHaveTextContent('4')
    expect(access).toHaveTextContent('Roles (1), Access Profiles (1), Entitlements (2)')
    // Five person-item rows, four distinct items.
    expect(screen.getByText('Total Decisions').closest('.vc-metric')).toHaveTextContent('5')
  })

  it('shows a placeholder on Total Decisions and Users until the review items load', () => {
    render(
      <CampaignDashboard
        campaign={campaign}
        items={null}
        onStartReviewing={vi.fn()}
        now={now}
      />,
    )
    expect(screen.getByText('Total Decisions').closest('.vc-metric')).toHaveTextContent('—')
    expect(screen.getByText('Users').closest('.vc-metric')).toHaveTextContent('—')
    const access = screen.getByText('Access items').closest('.vc-metric')
    expect(access).toHaveTextContent('—')
    expect(access).toHaveTextContent('Roles (—), Access Profiles (—), Entitlements (—)')
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
