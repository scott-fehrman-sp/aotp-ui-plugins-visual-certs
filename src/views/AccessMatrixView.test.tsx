import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import { buildAccessScene } from '../graph/buildAccessScene'
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

describe('AccessMatrixView', () => {
  it('renders the graph surface with the preserved chrome for the worked example', () => {
    const matrix = readyState(workedExample())
    const { container } = render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={matrix}
        onBack={vi.fn()}
      />,
    )

    // Preserved chrome: the back button and the title.
    expect(
      screen.getByRole('button', { name: /back to overview/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'All access paths' }),
    ).toBeInTheDocument()

    // The React Flow surface mounts (DOM only — test.css is false so no layout).
    expect(container.querySelector('.react-flow')).not.toBeNull()

    // The scene the canvas builds carries every graph node as a labeled node.
    const scene = buildAccessScene(matrix.graph, 'LR')
    const labels = scene.nodes.map((node) => node.data.label)
    expect(labels).toContain('User One')
    expect(labels).toContain('Role A')
    expect(labels).toContain('engr db')
    expect(labels).toContain('read')
  })

  it('defaults to the user grid and reveals a user’s node labels on drill-down', () => {
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={readyState(workedExample())}
        onBack={vi.fn()}
      />,
    )
    // Default (grid) mode: only the user card shows; role/source nodes do not.
    expect(
      screen.getByRole('button', { name: 'Show access for User One' }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Role: Role A')).not.toBeInTheDocument()

    // Drilling into the user reveals that user's role/source node labels.
    fireEvent.click(
      screen.getByRole('button', { name: 'Show access for User One' }),
    )
    expect(screen.getByLabelText('Role: Role A')).toBeInTheDocument()
    expect(screen.getByLabelText('Source: engr db')).toBeInTheDocument()
  })

  it('calls onBack when the back button is clicked', async () => {
    const onBack = vi.fn()
    render(
      <AccessMatrixView
        campaignName="Q3 review"
        matrix={readyState(workedExample())}
        onBack={onBack}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: /back to overview/i }),
    )
    expect(onBack).toHaveBeenCalledOnce()
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
