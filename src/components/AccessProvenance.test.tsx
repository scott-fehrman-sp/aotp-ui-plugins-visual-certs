import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AccessProvenanceVM, ProvenanceEntry } from '../sailpoint/types'
import { AccessProvenance } from './AccessProvenance'

function vm(overrides: Partial<AccessProvenanceVM>): AccessProvenanceVM {
  return {
    itemId: 'r1',
    grantMechanism: 'unknown',
    mechanismLabel: 'Granted outside an access request',
    request: null,
    approvals: [],
    grantedOn: null,
    historyUnavailable: false,
    ...overrides,
  }
}

function entry(overrides: Partial<ProvenanceEntry>): ProvenanceEntry {
  return { status: 'idle', data: null, ...overrides }
}

describe('AccessProvenance badge', () => {
  it('shows a loading placeholder while resolving', () => {
    render(<AccessProvenance entry={entry({ status: 'loading' })} />)
    expect(screen.getByText(/checking how they got this/i)).toBeInTheDocument()
  })

  it('shows the mechanism label when ready', () => {
    render(
      <AccessProvenance
        entry={entry({
          status: 'ready',
          data: vm({ grantMechanism: 'request', mechanismLabel: 'Via access request' }),
        })}
      />,
    )
    expect(screen.getByText('Via access request')).toBeInTheDocument()
  })

  it('shows the role label for a role mechanism', () => {
    render(
      <AccessProvenance
        entry={entry({
          status: 'ready',
          data: vm({ grantMechanism: 'role', mechanismLabel: 'Part of a role' }),
        })}
      />,
    )
    expect(screen.getByText('Part of a role')).toBeInTheDocument()
  })

  it('shows an unavailable badge', () => {
    render(<AccessProvenance entry={entry({ status: 'unavailable' })} />)
    expect(screen.getByText(/how they got this isn't available/i)).toBeInTheDocument()
  })
})

describe('AccessProvenance disclosure', () => {
  it('toggles aria-expanded and reveals the requester → approver chain', async () => {
    render(
      <AccessProvenance
        entry={entry({
          status: 'ready',
          data: vm({
            grantMechanism: 'request',
            mechanismLabel: 'Via access request',
            request: {
              requestedBy: 'Dana Requester',
              requestedOn: '2024-03-01T00:00:00Z',
              justification: 'Need it for the audit',
            },
            approvals: [
              {
                approver: 'Mel Manager',
                decision: 'approved',
                decidedOn: '2024-03-02T00:00:00Z',
                comment: 'Looks fine',
              },
            ],
          }),
        })}
      />,
    )

    const toggle = screen.getByRole('button', { name: /how they got this/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    expect(screen.getByText(/dana requester/i)).toBeInTheDocument()
    expect(screen.getByText(/mel manager/i)).toBeInTheDocument()
    expect(screen.getByText(/approved/i)).toBeInTheDocument()
    expect(screen.getByText(/looks fine/i)).toBeInTheDocument()
    expect(screen.getByText(/need it for the audit/i)).toBeInTheDocument()
  })

  it('shows an honest empty state for direct access with no request', async () => {
    render(
      <AccessProvenance
        entry={entry({
          status: 'ready',
          data: vm({ grantMechanism: 'direct', mechanismLabel: 'Assigned directly' }),
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /how they got this/i }))
    expect(screen.getByText(/no access request on record/i)).toBeInTheDocument()
  })

  it('words the degraded state when history could not load', async () => {
    render(
      <AccessProvenance
        entry={entry({
          status: 'ready',
          data: vm({ grantMechanism: 'unknown', historyUnavailable: true }),
        })}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /how they got this/i }))
    expect(screen.getByText(/couldn't load how this was granted/i)).toBeInTheDocument()
  })
})
