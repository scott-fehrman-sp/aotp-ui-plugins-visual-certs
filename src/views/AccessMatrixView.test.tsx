import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import type { AccessMatrixState } from '../state/useAccessMatrix'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import { AccessMatrixView } from './AccessMatrixView'

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

function workedExample(): AccessMatrixRowVM[] {
  return [
    row({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
    row({ id: '2', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'write', entitlementId: 'e2', source: 'engr db', sourceId: 's1' }),
    row({ id: '3', role: 'Role A', roleId: 'role-a', accessProfile: '', entitlement: 'delete', entitlementId: 'e3', source: 'engr db', sourceId: 's1' }),
    row({ id: '4', accessProfile: 'bar', accessProfileId: 'ap-bar', entitlement: 'read', entitlementId: 'e4', source: 'accounting db', sourceId: 's2' }),
    row({ id: '5', accessProfile: 'bar', accessProfileId: 'ap-bar', entitlement: 'search', entitlementId: 'e5', source: 'accounting db', sourceId: 's2' }),
    row({ id: '6', entitlement: 'read', entitlementId: 'e6', source: 'phone app', sourceId: 's3' }),
  ]
}

function readyState(
  rows: AccessMatrixRowVM[],
  overrides: Partial<AccessMatrixState> = {},
): AccessMatrixState {
  return {
    status: 'ready',
    rows,
    graph: deriveAccessGraph(rows),
    unresolvedCount: 0,
    error: null,
    reload: vi.fn(),
    ...overrides,
  }
}

/** Reads the Role column (2nd cell) of each body row, in DOM order. */
function roleColumn(): string[] {
  const rows = screen.getAllByRole('row').slice(1) // drop the header row
  return rows.map((r) => within(r).getAllByRole('cell')[0].textContent ?? '')
}

describe('AccessMatrixView', () => {
  it('renders the 6 worked-example rows', () => {
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={readyState(workedExample())}
        onBack={vi.fn()}
      />,
    )
    // 1 header row + 6 body rows.
    expect(screen.getAllByRole('row')).toHaveLength(7)
    expect(screen.getByText('delete')).toBeInTheDocument()
    expect(screen.getByText('search')).toBeInTheDocument()
  })

  it('toggles aria-sort and reorders rows when a column header is clicked', async () => {
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={readyState(workedExample())}
        onBack={vi.fn()}
      />,
    )

    const roleHeader = screen.getByRole('columnheader', { name: /role/i })
    const sourceHeader = screen.getByRole('columnheader', { name: /source/i })

    // Default sort is user/ascending, so no column is actively sorted beyond the
    // default; the Role header starts unsorted.
    expect(roleHeader).toHaveAttribute('aria-sort', 'none')

    // Click Role -> ascending; blanks sort FIRST.
    await userEvent.click(within(roleHeader).getByRole('button'))
    expect(roleHeader).toHaveAttribute('aria-sort', 'ascending')
    // Other columns stay 'none'.
    expect(sourceHeader).toHaveAttribute('aria-sort', 'none')
    // Blank role cells render a visually-hidden "(not applicable)" marker, so
    // their textContent is that marker rather than an empty string.
    const BLANK = '(not applicable)'
    const asc = roleColumn()
    // Three blank-role rows come first (ascending).
    expect(asc.slice(0, 3)).toEqual([BLANK, BLANK, BLANK])
    expect(asc.slice(3)).toEqual(['Role A', 'Role A', 'Role A'])

    // Click Role again -> descending; blanks sort LAST.
    await userEvent.click(within(roleHeader).getByRole('button'))
    expect(roleHeader).toHaveAttribute('aria-sort', 'descending')
    const desc = roleColumn()
    expect(desc.slice(0, 3)).toEqual(['Role A', 'Role A', 'Role A'])
    expect(desc.slice(3)).toEqual([BLANK, BLANK, BLANK])
  })

  it('exposes column and row header scopes and a visually-hidden caption', () => {
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={readyState(workedExample())}
        onBack={vi.fn()}
      />,
    )
    // Five column headers.
    expect(screen.getAllByRole('columnheader')).toHaveLength(5)
    // The User cell of each row is a row header (scope="row") -> 6 of them.
    const rowHeaders = screen
      .getAllByRole('rowheader')
      .filter((el) => el.textContent === 'User One')
    expect(rowHeaders).toHaveLength(6)
    // Caption states the blank-sorts-first convention.
    expect(
      screen.getByText(/blank cells sort first when sorting ascending/i),
    ).toBeInTheDocument()
  })

  it('shows the loading state', () => {
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={readyState([], { status: 'loading' })}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByText('Building the access map…')).toBeInTheDocument()
  })

  it('shows the empty state when ready with zero rows', () => {
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={readyState([])}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByText('No access to map')).toBeInTheDocument()
  })

  it('shows the error state with a retry', async () => {
    const reload = vi.fn()
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={readyState([], {
          status: 'error',
          error: 'It broke',
          reload,
        })}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByText('It broke')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('shows a non-fatal banner when there are unresolved rows', () => {
    const rows = [
      row({ id: 'x', role: 'Role A', roleId: 'role-a', unresolved: true }),
    ]
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={readyState(rows, { unresolvedCount: 1 })}
        onBack={vi.fn()}
      />,
    )
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/1 access path/i)
    expect(banner).toHaveTextContent(/Unresolved/i)
  })
})
