import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SearchApi } from 'sailpoint-api-client/search/api'
import { describe, expect, it, vi } from 'vitest'
import type { IdentityOption } from '../sailpoint/types'
import { AccessDecisionDialog } from './AccessDecisionDialog'

const searchIdentities = vi.fn()
vi.mock('../sailpoint/identities', async () => {
  const actual = await vi.importActual<typeof import('../sailpoint/identities')>(
    '../sailpoint/identities',
  )
  return { ...actual, searchIdentities: (...args: unknown[]) => searchIdentities(...args) }
})

const fakeSearchApi = {} as unknown as SearchApi
const recipient: IdentityOption = {
  id: 'i9',
  displayName: 'Pat Ng',
  email: 'pat@example.com',
}

describe('AccessDecisionDialog', () => {
  it('approves with no comment when none is required', async () => {
    const onConfirm = vi.fn()
    render(
      <AccessDecisionDialog
        action="approve"
        count={3}
        commentRequirement="none"
        submitting={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: /approve access/i })
    expect(dialog).toHaveTextContent('3 access items')
    expect(dialog).toHaveTextContent(/all 3 selected access items will be approved/i)
    await userEvent.click(screen.getByRole('button', { name: 'Approve Access' }))
    expect(onConfirm).toHaveBeenCalledWith('')
  })

  it('submits a reason the operator writes themselves', async () => {
    const onConfirm = vi.fn()
    render(
      <AccessDecisionDialog
        action="revoke"
        count={1}
        commentRequirement="none"
        submitting={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog')).toHaveTextContent(/this access item will be revoked/i)
    await userEvent.selectOptions(screen.getByLabelText(/reason/i), 'Write my own…')
    await userEvent.type(screen.getByRole('textbox', { name: /your reason/i }), 'Left the project')
    await userEvent.click(screen.getByRole('button', { name: 'Revoke Access' }))
    expect(onConfirm).toHaveBeenCalledWith('Left the project')
  })

  it('keeps Revoke Access disabled until a required reason is chosen', async () => {
    const onConfirm = vi.fn()
    render(
      <AccessDecisionDialog
        action="revoke"
        count={2}
        commentRequirement="revokeOnly"
        submitting={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    const confirm = screen.getByRole('button', { name: 'Revoke Access' })
    expect(confirm).toBeDisabled()
    await userEvent.selectOptions(
      screen.getByLabelText(/reason/i),
      'No longer needed for their job',
    )
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('No longer needed for their job')
  })

  it('cancels from the button and from Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <AccessDecisionDialog
        action="approve"
        count={1}
        commentRequirement="none"
        submitting={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('reassigns only after a person and a reason are both chosen', async () => {
    const user = userEvent.setup()
    const onConfirmReassign = vi.fn()
    searchIdentities.mockResolvedValue([recipient])
    render(
      <AccessDecisionDialog
        action="reassign"
        count={4}
        commentRequirement="none"
        submitting={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        searchApi={fakeSearchApi}
        onConfirmReassign={onConfirmReassign}
      />,
    )

    expect(screen.getByRole('dialog')).toHaveTextContent(/all 4 selected access items will be reassigned/i)
    const confirm = screen.getByRole('button', { name: 'Reassign Access' })
    expect(confirm).toBeDisabled()
    await user.selectOptions(screen.getByLabelText(/reason/i), 'Write my own…')
    await user.type(screen.getByRole('textbox', { name: /your reason/i }), 'Covering this team')
    expect(confirm).toBeDisabled()
    await user.type(screen.getByRole('combobox', { name: /assign to/i }), 'pa')
    await user.click(await screen.findByText('Pat Ng'))
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(onConfirmReassign).toHaveBeenCalledWith('i9', 'Covering this team')
  })
})
