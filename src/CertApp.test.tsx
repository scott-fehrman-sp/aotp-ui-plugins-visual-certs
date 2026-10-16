import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CertificationsApi } from 'sailpoint-api-client/certifications/api'
import { describe, expect, it, vi } from 'vitest'
import { CertApp } from './CertApp'
import type { PluginRuntime } from './sailpoint/sdkClient'

/** A raw IdentityCertificationDto as the API would return it. */
function certDto(id: string, name: string, due: string) {
  return {
    id,
    name,
    due,
    decisionsMade: 0,
    decisionsTotal: 4,
    phase: 'ACTIVE',
    campaign: {
      id: `camp-${id}`,
      name,
      type: 'CAMPAIGN',
      campaignType: 'MANAGER',
      description: null,
      correlatedStatus: 'CORRELATED',
      mandatoryCommentRequirement: 'NO_DECISIONS',
    },
  }
}

interface BuildOptions {
  campaigns: ReturnType<typeof certDto>[]
  subPath?: string
}

function buildRuntime({ campaigns, subPath = '' }: BuildOptions): {
  runtime: PluginRuntime
  setRoute: ReturnType<typeof vi.fn>
} {
  const setRoute = vi.fn().mockResolvedValue(undefined)
  const api = {
    listIdentityCertificationsV1: vi.fn().mockResolvedValue({ data: campaigns }),
    getIdentityCertificationV1: vi
      .fn()
      .mockImplementation(({ id }: { id: string }) => {
        const match = campaigns.find((c) => c.id === id) ?? campaigns[0]
        return Promise.resolve({ data: match })
      }),
    // Review items are loaded by the dashboard/review step; default to empty.
    listIdentityAccessReviewItemsV1: vi.fn().mockResolvedValue({ data: [] }),
  } as unknown as CertificationsApi

  const runtime = {
    sdk: { navigation: { setRoute } },
    certificationsApi: api,
    summariesApi: {},
    // The reassign flow's identity picker needs a SearchApi on the runtime.
    searchApi: { searchPostV1: vi.fn().mockResolvedValue({ data: [] }) },
    accessRequestsApi: {
      listAccessRequestStatusV1: vi.fn().mockResolvedValue({ data: [] }),
    },
    identityHistoryApi: {
      getHistoricalIdentityEventsV1: vi.fn().mockResolvedValue({ data: [] }),
    },
    user: { id: 'u1', displayName: 'Dana', email: '', isCertAdmin: false },
    context: { page: { subPath, route: '' } },
  } as unknown as PluginRuntime

  return { runtime, setRoute }
}

describe('CertApp routing', () => {
  it('shows the picker when the user has multiple campaigns', async () => {
    const { runtime } = buildRuntime({
      campaigns: [
        certDto('c1', 'Finance review', '2026-02-01T00:00:00Z'),
        certDto('c2', 'Sales review', '2026-03-01T00:00:00Z'),
      ],
    })

    render(<CertApp runtime={runtime} />)

    expect(await screen.findByText(/2 reviews to do/i)).toBeInTheDocument()
    expect(screen.getByText('Finance review')).toBeInTheDocument()
    expect(screen.getByText('Sales review')).toBeInTheDocument()
  })

  it('auto-advances to the dashboard with a single campaign', async () => {
    const { runtime, setRoute } = buildRuntime({
      campaigns: [certDto('c1', 'Finance review', '2026-02-01T00:00:00Z')],
    })

    render(<CertApp runtime={runtime} />)

    // Dashboard shows the campaign heading and reports the route to App Shell.
    expect(
      await screen.findByRole('heading', { name: 'Finance review' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(setRoute).toHaveBeenCalledWith('campaign/c1'),
    )
  })

  it('navigates from the picker to a dashboard on selection', async () => {
    const { runtime } = buildRuntime({
      campaigns: [
        certDto('c1', 'Finance review', '2026-02-01T00:00:00Z'),
        certDto('c2', 'Sales review', '2026-03-01T00:00:00Z'),
      ],
    })

    render(<CertApp runtime={runtime} />)

    await userEvent.click(await screen.findByText('Sales review'))

    expect(
      await screen.findByRole('heading', { name: 'Sales review' }),
    ).toBeInTheDocument()
  })

  it('restores a deep-linked campaign from the host subPath', async () => {
    const { runtime } = buildRuntime({
      campaigns: [
        certDto('c1', 'Finance review', '2026-02-01T00:00:00Z'),
        certDto('c2', 'Sales review', '2026-03-01T00:00:00Z'),
      ],
      subPath: 'campaign/c2',
    })

    render(<CertApp runtime={runtime} />)

    expect(
      await screen.findByRole('heading', { name: 'Sales review' }),
    ).toBeInTheDocument()
  })

  it('shows a reassuring empty state when there are no campaigns', async () => {
    const { runtime } = buildRuntime({ campaigns: [] })

    render(<CertApp runtime={runtime} />)

    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument()
  })

  it('runs the full flow: dashboard → review → decide → sign off', async () => {
    const user = userEvent.setup()
    const cert = certDto('c1', 'Finance review', '2026-02-01T00:00:00Z')
    const reviewItemDto = {
      id: 'item-1',
      completed: false,
      newAccess: true,
      identitySummary: { id: 's1', name: 'Alex Kim' },
      accessSummary: {
        access: { type: 'ENTITLEMENT', id: 'e1', name: 'Payroll Admin' },
        entitlement: {
          id: 'e1',
          name: 'Payroll Admin',
          sourceName: 'Finance App',
          privileged: true,
          revocable: true,
        },
      },
    }

    const makeIdentityDecisionV1 = vi
      .fn()
      .mockResolvedValue({ data: { ...cert, decisionsMade: 1, decisionsTotal: 1 } })
    const signOffIdentityCertificationV1 = vi
      .fn()
      .mockResolvedValue({ data: { ...cert, signed: '2026-01-11T00:00:00Z', phase: 'SIGNED' } })

    const api = {
      listIdentityCertificationsV1: vi.fn().mockResolvedValue({ data: [cert] }),
      getIdentityCertificationV1: vi.fn().mockResolvedValue({ data: cert }),
      listIdentityAccessReviewItemsV1: vi
        .fn()
        .mockResolvedValue({ data: [reviewItemDto] }),
      makeIdentityDecisionV1,
      signOffIdentityCertificationV1,
    } as unknown as CertificationsApi

    const runtime = {
      sdk: { navigation: { setRoute: vi.fn().mockResolvedValue(undefined) } },
      certificationsApi: api,
      summariesApi: {},
      searchApi: { searchPostV1: vi.fn().mockResolvedValue({ data: [] }) },
      accessRequestsApi: {
        listAccessRequestStatusV1: vi.fn().mockResolvedValue({ data: [] }),
      },
      identityHistoryApi: {
        getHistoricalIdentityEventsV1: vi.fn().mockResolvedValue({ data: [] }),
      },
      user: { id: 'u1', displayName: 'Dana', email: '', isCertAdmin: false },
      context: { page: { subPath: '', route: '' } },
    } as unknown as PluginRuntime

    render(<CertApp runtime={runtime} />)

    // Lands on the dashboard (single campaign) and offers to start reviewing.
    await user.click(await screen.findByRole('button', { name: /start reviewing/i }))

    // Review queue shows the item; decide to remove it (card button is "Remove").
    await user.click(await screen.findByRole('button', { name: /^remove$/i }))

    // Confirmation dialog appears; comment not required (NO_DECISIONS).
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^remove access$/i }))
    expect(makeIdentityDecisionV1).toHaveBeenCalled()

    // Everything decided → sign-off CTA appears; go to sign off.
    await user.click(await screen.findByRole('button', { name: /review and sign off/i }))

    // Confirm and sign off.
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /sign off and finish/i }))

    await waitFor(() => expect(signOffIdentityCertificationV1).toHaveBeenCalledWith({ id: 'c1' }))
    expect(await screen.findByText(/this review is complete/i)).toBeInTheDocument()
  })

  it('opens the reassign dialog with the runtime SearchApi wired to the picker', async () => {
    const user = userEvent.setup()
    const cert = certDto('c1', 'Finance review', '2026-02-01T00:00:00Z')
    const reviewItemDto = {
      id: 'item-1',
      completed: false,
      identitySummary: { id: 's1', name: 'Alex Kim' },
      accessSummary: {
        access: { type: 'ENTITLEMENT', id: 'e1', name: 'Payroll Admin' },
        entitlement: { id: 'e1', name: 'Payroll Admin', revocable: true },
      },
    }

    // The picker calls this SearchApi once the reassign dialog is open and a
    // query is typed, proving runtime.searchApi reached DecisionDialog.
    const searchPostV1 = vi.fn().mockResolvedValue({
      data: [{ id: 'i9', displayName: 'Pat Ng', email: 'pat@example.com' }],
    })

    const api = {
      listIdentityCertificationsV1: vi.fn().mockResolvedValue({ data: [cert] }),
      getIdentityCertificationV1: vi.fn().mockResolvedValue({ data: cert }),
      listIdentityAccessReviewItemsV1: vi
        .fn()
        .mockResolvedValue({ data: [reviewItemDto] }),
    } as unknown as CertificationsApi

    const runtime = {
      sdk: { navigation: { setRoute: vi.fn().mockResolvedValue(undefined) } },
      certificationsApi: api,
      summariesApi: {},
      searchApi: { searchPostV1 },
      accessRequestsApi: {
        listAccessRequestStatusV1: vi.fn().mockResolvedValue({ data: [] }),
      },
      identityHistoryApi: {
        getHistoricalIdentityEventsV1: vi.fn().mockResolvedValue({ data: [] }),
      },
      user: { id: 'u1', displayName: 'Dana', email: '', isCertAdmin: false },
      context: { page: { subPath: '', route: '' } },
    } as unknown as PluginRuntime

    render(<CertApp runtime={runtime} />)

    await user.click(await screen.findByRole('button', { name: /start reviewing/i }))
    await user.click(await screen.findByRole('button', { name: /^reassign$/i }))

    // The dialog shows the picker; typing drives the injected SearchApi.
    const picker = await screen.findByRole('combobox', { name: '' })
    await user.type(picker, 'pat')
    await waitFor(() => expect(searchPostV1).toHaveBeenCalled())
    expect(await screen.findByText('Pat Ng')).toBeInTheDocument()
  })

  it('renders the queue immediately and resolves provenance without gating the list', async () => {
    const user = userEvent.setup()
    const cert = certDto('c1', 'Finance review', '2026-02-01T00:00:00Z')
    const reviewItemDto = {
      id: 'item-1',
      completed: false,
      identitySummary: { id: 's1', identityId: 'identity-1', name: 'Alex Kim' },
      accessSummary: {
        access: { type: 'ENTITLEMENT', id: 'e1', name: 'Payroll Admin' },
        entitlement: { id: 'e1', name: 'Payroll Admin', revocable: true },
      },
    }

    const api = {
      listIdentityCertificationsV1: vi.fn().mockResolvedValue({ data: [cert] }),
      getIdentityCertificationV1: vi.fn().mockResolvedValue({ data: cert }),
      listIdentityAccessReviewItemsV1: vi
        .fn()
        .mockResolvedValue({ data: [reviewItemDto] }),
    } as unknown as CertificationsApi

    // The access-request fetch matches the item by name + type -> "request".
    const listAccessRequestStatusV1 = vi.fn().mockResolvedValue({
      data: [
        {
          name: 'Payroll Admin',
          type: 'ENTITLEMENT',
          created: '2024-01-01T00:00:00Z',
          requester: { name: 'Dana Requester' },
        },
      ],
    })

    const runtime = {
      sdk: { navigation: { setRoute: vi.fn().mockResolvedValue(undefined) } },
      certificationsApi: api,
      summariesApi: {},
      searchApi: { searchPostV1: vi.fn().mockResolvedValue({ data: [] }) },
      accessRequestsApi: { listAccessRequestStatusV1 },
      identityHistoryApi: {
        getHistoricalIdentityEventsV1: vi.fn().mockResolvedValue({ data: [] }),
      },
      user: { id: 'u1', displayName: 'Dana', email: '', isCertAdmin: false },
      context: { page: { subPath: '', route: '' } },
    } as unknown as PluginRuntime

    render(<CertApp runtime={runtime} />)

    await user.click(await screen.findByRole('button', { name: /start reviewing/i }))

    // The queue (and its keep/remove actions) is interactive right away.
    expect(await screen.findByRole('button', { name: /^keep$/i })).toBeInTheDocument()

    // Provenance resolves afterward into a headline badge, without blocking.
    expect(await screen.findByText('Via access request')).toBeInTheDocument()
    expect(listAccessRequestStatusV1).toHaveBeenCalledWith(
      expect.objectContaining({ requestedFor: 'identity-1' }),
    )
  })
})
