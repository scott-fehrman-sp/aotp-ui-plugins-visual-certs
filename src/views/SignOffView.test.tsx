import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CertificationsApi } from 'sailpoint-api-client/certifications/api'
import { describe, expect, it, vi } from 'vitest'
import type { CampaignVM } from '../sailpoint/types'
import { SignOffView } from './SignOffView'

function campaign(overrides: Partial<CampaignVM> = {}): CampaignVM {
  return {
    id: 'c1',
    name: 'Team review',
    description: null,
    phase: 'inProgress',
    decisionsMade: 2,
    decisionsTotal: 2,
    due: null,
    signed: null,
    commentRequirement: 'none',
    ...overrides,
  }
}

describe('SignOffView', () => {
  it('blocks sign-off while items are still undecided', () => {
    const api = {} as CertificationsApi
    render(
      <SignOffView
        api={api}
        campaign={campaign()}
        outstanding={3}
        totalItems={5}
        approved={1}
        revoked={1}
        reassigned={0}
        onBack={vi.fn()}
        onSignedOff={vi.fn()}
      />,
    )
    expect(screen.getByText(/still have/i)).toHaveTextContent('3')
    expect(
      screen.queryByRole('button', { name: /sign off and finish/i }),
    ).not.toBeInTheDocument()
  })

  it('requires explicit confirmation before signing off', async () => {
    const signOffIdentityCertificationV1 = vi
      .fn()
      .mockResolvedValue({ data: { id: 'c1', signed: '2026-01-01T00:00:00Z' } })
    const api = { signOffIdentityCertificationV1 } as unknown as CertificationsApi
    const onSignedOff = vi.fn()

    render(
      <SignOffView
        api={api}
        campaign={campaign()}
        outstanding={0}
        totalItems={2}
        approved={1}
        revoked={1}
        reassigned={0}
        onBack={vi.fn()}
        onSignedOff={onSignedOff}
      />,
    )

    const button = screen.getByRole('button', { name: /sign off and finish/i })
    expect(button).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox'))
    expect(button).toBeEnabled()

    await userEvent.click(button)
    expect(signOffIdentityCertificationV1).toHaveBeenCalledWith({ id: 'c1' })
    expect(onSignedOff).toHaveBeenCalled()
  })

  it('lists kept, removed, and reassigned counts in the summary', () => {
    const api = {} as CertificationsApi
    render(
      <SignOffView
        api={api}
        campaign={campaign()}
        outstanding={0}
        totalItems={6}
        approved={3}
        revoked={2}
        reassigned={1}
        onBack={vi.fn()}
        onSignedOff={vi.fn()}
      />,
    )
    expect(screen.getByText('3 kept')).toBeInTheDocument()
    expect(screen.getByText('2 removed')).toBeInTheDocument()
    expect(screen.getByText('1 reassigned')).toBeInTheDocument()
  })

  it('shows a completed state for an already-signed campaign', () => {
    const api = {} as CertificationsApi
    render(
      <SignOffView
        api={api}
        campaign={campaign({ phase: 'done', signed: '2026-01-01T00:00:00Z' })}
        outstanding={0}
        totalItems={2}
        approved={2}
        revoked={0}
        reassigned={0}
        onBack={vi.fn()}
        onSignedOff={vi.fn()}
      />,
    )
    expect(screen.getByText(/this review is complete/i)).toBeInTheDocument()
  })

  it('surfaces a friendly error when sign-off fails', async () => {
    const api = {
      signOffIdentityCertificationV1: vi
        .fn()
        .mockRejectedValue({ response: { status: 500 } }),
    } as unknown as CertificationsApi

    render(
      <SignOffView
        api={api}
        campaign={campaign()}
        outstanding={0}
        totalItems={2}
        approved={2}
        revoked={0}
        reassigned={0}
        onBack={vi.fn()}
        onSignedOff={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /sign off and finish/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/problem on its end/i)
  })
})
