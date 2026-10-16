import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SearchApi } from 'sailpoint-api-client/search/api'
import { describe, expect, it, vi } from 'vitest'
import type { IdentityOption, ReviewItemVM } from '../sailpoint/types'
import { DecisionDialog } from './DecisionDialog'

// The reassign tests drive the embedded IdentityPicker, so mock the identity
// search the picker calls, keeping the picker's own behavior real.
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

const item: ReviewItemVM = {
  id: 'r1',
  identityId: 'id-r1',
  completed: false,
  decision: null,
  reassigned: false,
  comments: null,
  personName: 'Sam Lee',
  accessName: 'Admin Console',
  accessKind: 'entitlement',
  accessDescription: null,
  sourceName: 'Finance App',
  isNewAccess: false,
  isPrivileged: true,
  isCloudGoverned: false,
  dataImpact: null,
  usageDays: null,
  aiRecommendation: null,
  revocable: true,
}

describe('DecisionDialog', () => {
  it('confirms an allow decision with no comment when none is required', async () => {
    const onConfirm = vi.fn()
    render(
      <DecisionDialog
        item={item}
        choice="allow"
        commentRequirement="none"
        submitting={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog')).toHaveTextContent(/keep access for sam lee/i)
    await userEvent.click(screen.getByRole('button', { name: /^keep access$/i }))
    expect(onConfirm).toHaveBeenCalledWith('')
  })

  it('submits a chosen canned comment', async () => {
    const onConfirm = vi.fn()
    render(
      <DecisionDialog
        item={item}
        choice="remove"
        commentRequirement="none"
        submitting={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    await userEvent.selectOptions(
      screen.getByRole('combobox'),
      'No longer needed for their job',
    )
    await userEvent.click(screen.getByRole('button', { name: /^remove access$/i }))
    expect(onConfirm).toHaveBeenCalledWith('No longer needed for their job')
  })

  it('lets the user switch to a custom comment', async () => {
    const onConfirm = vi.fn()
    render(
      <DecisionDialog
        item={item}
        choice="allow"
        commentRequirement="none"
        submitting={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    await userEvent.selectOptions(screen.getByRole('combobox'), 'Write my own…')
    await userEvent.type(
      screen.getByRole('textbox', { name: /your reason/i }),
      'Confirmed in team meeting',
    )
    await userEvent.click(screen.getByRole('button', { name: /^keep access$/i }))
    expect(onConfirm).toHaveBeenCalledWith('Confirmed in team meeting')
  })

  it('keeps confirm disabled until a required comment is provided', async () => {
    const onConfirm = vi.fn()
    render(
      <DecisionDialog
        item={item}
        choice="remove"
        commentRequirement="revokeOnly"
        submitting={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    const confirm = screen.getByRole('button', { name: /^remove access$/i })
    expect(confirm).toBeDisabled()

    await userEvent.selectOptions(
      screen.getByRole('combobox'),
      'Person changed roles',
    )
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('Person changed roles')
  })

  it('does not require a comment to allow when only revokes require one', () => {
    render(
      <DecisionDialog
        item={item}
        choice="allow"
        commentRequirement="revokeOnly"
        submitting={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /^keep access$/i })).toBeEnabled()
  })

  it('cancels without deciding', async () => {
    const onCancel = vi.fn()
    render(
      <DecisionDialog
        item={item}
        choice="allow"
        commentRequirement="none"
        submitting={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  describe('reassign mode', () => {
    it('keeps Confirm disabled until BOTH an identity and comment are chosen', async () => {
      const user = userEvent.setup()
      const onConfirmReassign = vi.fn()
      searchIdentities.mockResolvedValue([recipient])
      render(
        <DecisionDialog
          item={item}
          choice="reassign"
          commentRequirement="none"
          submitting={false}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
          searchApi={fakeSearchApi}
          onConfirmReassign={onConfirmReassign}
        />,
      )

      const confirm = screen.getByRole('button', { name: /^reassign$/i })
      expect(confirm).toBeDisabled()

      // Pick a comment first — still disabled with no recipient. The comment
      // <select> is labelled "Add a reason (required)".
      await user.selectOptions(
        screen.getByLabelText(/add a reason/i),
        'This belongs to another manager.',
      )
      expect(confirm).toBeDisabled()

      // Now choose a person via the picker's search combobox.
      const picker = screen.getByRole('combobox', { name: '' })
      await user.type(picker, 'pa')
      await user.click(await screen.findByText('Pat Ng'))

      expect(confirm).toBeEnabled()
      await user.click(confirm)
      expect(onConfirmReassign).toHaveBeenCalledWith(
        'i9',
        'This belongs to another manager.',
      )
    })

    it('requires a comment even when a person is selected', async () => {
      const user = userEvent.setup()
      searchIdentities.mockResolvedValue([recipient])
      render(
        <DecisionDialog
          item={item}
          choice="reassign"
          commentRequirement="none"
          submitting={false}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
          searchApi={fakeSearchApi}
          onConfirmReassign={vi.fn()}
        />,
      )

      const picker = screen.getByRole('combobox', { name: '' })
      await user.type(picker, 'pa')
      await user.click(await screen.findByText('Pat Ng'))

      // Person chosen but no comment yet → still disabled.
      expect(screen.getByRole('button', { name: /^reassign$/i })).toBeDisabled()
    })
  })
})
