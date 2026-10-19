import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import { AccessGraphCanvas } from './AccessGraphCanvas'

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

/** Two users, each with a distinct access path, for mode-switch assertions. */
function twoUsers(): AccessMatrixRowVM[] {
  return [
    row({ id: '1', userId: 'u1', user: 'User One', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1' }),
    row({ id: '2', userId: 'u2', user: 'User Two', accessProfile: 'bar', accessProfileId: 'ap-bar', entitlement: 'write', entitlementId: 'e2', source: 'accounting db', sourceId: 's2' }),
  ]
}

// React Flow's pane uses d3-zoom, whose pointer sequence breaks in jsdom, so we
// fire plain DOM events on the card's own (React) handlers rather than driving a
// full pointer/zoom interaction. Geometry is covered by the pure-builder tests;
// here we assert label presence, mode switches, and control wiring only.
describe('AccessGraphCanvas', () => {
  it('defaults to the grid: shows user cards, not role/entitlement/source', () => {
    const graph = deriveAccessGraph(twoUsers())
    render(<AccessGraphCanvas graph={graph} />)

    expect(screen.getByRole('button', { name: 'Show access for User One' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show access for User Two' })).toBeInTheDocument()
    // Non-user labels must not appear in grid mode.
    expect(screen.queryByText('Role A')).not.toBeInTheDocument()
    expect(screen.queryByText('read')).not.toBeInTheDocument()
    expect(screen.queryByText('engr db')).not.toBeInTheDocument()
  })

  it('exposes the user count to screen readers in grid mode', () => {
    const graph = deriveAccessGraph(twoUsers())
    render(<AccessGraphCanvas graph={graph} />)
    expect(screen.getByText(/showing 2 users/i)).toBeInTheDocument()
  })

  it('clicking a user card drills into that user access subgraph', () => {
    const graph = deriveAccessGraph(twoUsers())
    render(<AccessGraphCanvas graph={graph} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))

    // User One's path labels appear.
    expect(screen.getByText('Role A')).toBeInTheDocument()
    expect(screen.getByText('read')).toBeInTheDocument()
    expect(screen.getByText('engr db')).toBeInTheDocument()
    // User Two's path stays out of this user's subgraph.
    expect(screen.queryByText('write')).not.toBeInTheDocument()
    expect(screen.queryByText('accounting db')).not.toBeInTheDocument()
  })

  it('activating a user card with keyboard Enter drills in', () => {
    const graph = deriveAccessGraph(twoUsers())
    render(<AccessGraphCanvas graph={graph} />)

    const card = screen.getByRole('button', { name: 'Show access for User Two' })
    fireEvent.keyDown(card, { key: 'Enter' })

    expect(screen.getByText('bar')).toBeInTheDocument()
    expect(screen.getByText('write')).toBeInTheDocument()
    expect(screen.getByText('accounting db')).toBeInTheDocument()
  })

  it('"Back to all users" returns to the grid', () => {
    const graph = deriveAccessGraph(twoUsers())
    render(<AccessGraphCanvas graph={graph} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show access for User One' }))
    expect(screen.getByText('Role A')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /back to all users/i }))

    // Grid is back: user cards present, non-user labels gone.
    expect(screen.getByRole('button', { name: 'Show access for User One' })).toBeInTheDocument()
    expect(screen.queryByText('Role A')).not.toBeInTheDocument()
  })

  it('renders an empty state when the graph has no users', () => {
    render(<AccessGraphCanvas graph={{ nodes: [], edges: [] }} />)
    expect(screen.getByText('No users to map')).toBeInTheDocument()
  })
})
