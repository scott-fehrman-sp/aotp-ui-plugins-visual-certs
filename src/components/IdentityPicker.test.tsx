import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SearchApi } from 'sailpoint-api-client/search/api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FriendlyError } from '../sailpoint/identities'
import type { IdentityOption } from '../sailpoint/types'
import { IdentityPicker } from './IdentityPicker'

// Mock the data layer so the picker's behavior is tested in isolation from the
// real Search API. We keep FriendlyError as the real class so the error branch
// is exercised faithfully.
const searchIdentities = vi.fn()
vi.mock('../sailpoint/identities', async () => {
  const actual = await vi.importActual<typeof import('../sailpoint/identities')>(
    '../sailpoint/identities',
  )
  return { ...actual, searchIdentities: (...args: unknown[]) => searchIdentities(...args) }
})

const fakeApi = {} as unknown as SearchApi

const people: IdentityOption[] = [
  { id: 'i1', displayName: 'Jane Doe', email: 'jane@example.com' },
  { id: 'i2', displayName: 'John Smith', email: 'john@example.com' },
]

afterEach(() => {
  searchIdentities.mockReset()
})

describe('IdentityPicker', () => {
  it('exposes combobox/listbox/option roles and debounced results', async () => {
    const user = userEvent.setup()
    searchIdentities.mockResolvedValue(people)
    render(<IdentityPicker searchApi={fakeApi} value={null} onChange={vi.fn()} />)

    const combobox = screen.getByRole('combobox')
    await user.type(combobox, 'ja')

    // The debounced search eventually fires with the typed term.
    await waitFor(() => expect(searchIdentities).toHaveBeenCalledWith(fakeApi, 'ja'))

    await screen.findByRole('option', { name: /jane doe/i })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('Jane Doe')
  })

  it('does not search for a single character', async () => {
    const user = userEvent.setup()
    searchIdentities.mockResolvedValue(people)
    render(<IdentityPicker searchApi={fakeApi} value={null} onChange={vi.fn()} />)

    await user.type(screen.getByRole('combobox'), 'j')
    // Give the debounce window time to elapse, then confirm no query ran.
    await new Promise((r) => setTimeout(r, 350))
    expect(searchIdentities).not.toHaveBeenCalled()
  })

  it('selects an option with the keyboard and reports it via onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    searchIdentities.mockResolvedValue(people)
    render(<IdentityPicker searchApi={fakeApi} value={null} onChange={onChange} />)

    const combobox = screen.getByRole('combobox')
    await user.type(combobox, 'jo')
    await screen.findByRole('option', { name: /jane doe/i })

    // ArrowDown moves from the first (auto-active) option to the second, Enter selects.
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith(people[1])
  })

  it('selects an option by click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    searchIdentities.mockResolvedValue(people)
    render(<IdentityPicker searchApi={fakeApi} value={null} onChange={onChange} />)

    await user.type(screen.getByRole('combobox'), 'ja')
    await user.click(await screen.findByText('Jane Doe'))
    expect(onChange).toHaveBeenCalledWith(people[0])
  })

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup()
    searchIdentities.mockResolvedValue([])
    render(<IdentityPicker searchApi={fakeApi} value={null} onChange={vi.fn()} />)

    await user.type(screen.getByRole('combobox'), 'zz')
    expect(await screen.findByText('No matches')).toBeInTheDocument()
  })

  it('shows a loading state while the search is in flight', async () => {
    const user = userEvent.setup()
    let resolve!: (v: IdentityOption[]) => void
    searchIdentities.mockReturnValue(
      new Promise<IdentityOption[]>((r) => {
        resolve = r
      }),
    )
    render(<IdentityPicker searchApi={fakeApi} value={null} onChange={vi.fn()} />)

    await user.type(screen.getByRole('combobox'), 'ja')
    expect(await screen.findByText('Searching…')).toBeInTheDocument()
    resolve(people)
    await screen.findByRole('option', { name: /jane doe/i })
  })

  it('surfaces a friendly error when the search fails', async () => {
    const user = userEvent.setup()
    searchIdentities.mockRejectedValue(new FriendlyError('Search is unavailable.'))
    render(<IdentityPicker searchApi={fakeApi} value={null} onChange={vi.fn()} />)

    await user.type(screen.getByRole('combobox'), 'ja')
    expect(await screen.findByRole('alert')).toHaveTextContent('Search is unavailable.')
  })

  it('renders the chosen person with a Clear button when a value is set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <IdentityPicker searchApi={fakeApi} value={people[0]} onChange={onChange} />,
    )

    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /clear/i }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
