import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Edge, Node } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { AccessGraphCanvas } from './AccessGraphCanvas'

// A separate file so wrapping ReactFlow (to record the nodes/edges it is given)
// and mocking fitView / setViewport leaves the other canvas tests untouched.
// jsdom cannot paint, so this asserts the DATA handed to React Flow and that
// hovering never refits or moves anything; painting is checked in a real browser.
const spies = vi.hoisted(() => ({
  fitView: vi.fn(() => Promise.resolve(true)),
  setViewport: vi.fn(() => Promise.resolve(true)),
  edges: [] as unknown[],
  nodes: [] as unknown[],
}))
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const Recorded = (props: React.ComponentProps<typeof actual.ReactFlow>) => {
    spies.edges = props.edges ?? []
    spies.nodes = props.nodes ?? []
    return <actual.ReactFlow {...props} />
  }
  return {
    ...actual,
    ReactFlow: Recorded,
    useReactFlow: () => ({
      ...actual.useReactFlow(),
      fitView: spies.fitView,
      setViewport: spies.setViewport,
    }),
  }
})

function row(overrides: Partial<StatusRow>): StatusRow {
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

/** role-a{ap-foo{e1}} needsReview; e2 / e3 held directly. */
function graph() {
  return statusGraph([
    row({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-a', accessItemName: 'Role A' }),
    row({ id: '2', entitlement: 'login', entitlementId: 'e2', source: 'phone app', sourceId: 's2', reviewStatus: 'approved', accessItemKind: 'entitlement', accessItemId: 'e2', accessItemName: 'login' }),
    row({ id: '3', entitlement: 'admin', entitlementId: 'e3', source: 'phone app', sourceId: 's2', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e3', accessItemName: 'admin' }),
  ])
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name })
const edges = () => spies.edges as Edge[]
const nodes = () => spies.nodes as Node[]
const card = (label: string) => screen.getByText(label).closest<HTMLElement>('.vc-graph-card')!
const drillIn = () => fireEvent.click(btn('Show access for User One'))
const emphasized = () => edges().filter((e) => e.className?.includes('vc-graph-edge-emphasized'))
const snapshot = () => structuredClone(edges())
const positions = () => nodes().map((n) => ({ id: n.id, ...n.position }))

describe('AccessGraphCanvas hover / focus edge emphasis', () => {
  beforeEach(() => {
    spies.fitView.mockClear()
    spies.setViewport.mockClear()
  })

  it('does not draw a user link on hover, and leaves the other links as they are', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items and reference start hidden by default; show both so the
    // completed `login` card and the reference edges exist
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(btn('Show reference nodes and links'))
    const before = snapshot()
    const login = card('login')
    fireEvent.mouseEnter(login)
    expect(emphasized()).toHaveLength(0)
    expect(edges().some((e) => e.source === 'user:u1')).toBe(false)
    expect(edges()).toEqual(before)
    fireEvent.mouseLeave(login)
    expect(edges()).toEqual(before)
  })

  it('does not draw a user link on focus', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them so the revoked `admin` card appears
    fireEvent.click(btn(/^Show completed items/))
    const before = snapshot()
    const admin = card('admin')
    fireEvent.focus(admin)
    expect(emphasized()).toHaveLength(0)
    expect(edges()).toEqual(before)
    fireEvent.blur(admin)
    expect(edges()).toEqual(before)
  })

  it('leaves the edges prop untouched when hovering a reference-only node', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // reference starts hidden by default; show it so the reference-only `foo` card appears
    fireEvent.click(btn('Show reference nodes and links'))
    const edgesBefore = edges()
    const reference = card('foo')
    expect(reference.className).toContain('vc-graph-card-reference')
    fireEvent.mouseEnter(reference)
    fireEvent.focus(reference)
    expect(edges()).toBe(edgesBefore)
  })

  it('hover and focus do not draw user links', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them so login/admin cards appear
    fireEvent.click(btn(/^Show completed items/))
    const before = snapshot()
    const login = card('login')
    const admin = card('admin')
    fireEvent.focus(admin)
    fireEvent.mouseEnter(login)
    fireEvent.mouseLeave(login)
    fireEvent.mouseEnter(admin)
    fireEvent.mouseLeave(login)
    fireEvent.blur(admin)
    expect(emphasized()).toHaveLength(0)
    expect(edges()).toEqual(before)
  })

  it('draws no links when reference is hidden, in either layout', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // reference starts hidden by default; completed items start hidden too, so
    // show them to reveal the revoked `admin` card
    fireEvent.click(btn(/^Show completed items/))
    expect(edges()).toHaveLength(0)
    fireEvent.mouseEnter(card('admin'))
    expect(edges()).toHaveLength(0)
    fireEvent.mouseLeave(card('admin'))
    fireEvent.mouseEnter(card('Role A'))
    expect(edges()).toHaveLength(0)
  })

  it('never refits, re-viewports or moves a node on hover or focus', async () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items and reference start hidden by default; show both so the
    // login/admin (completed) and foo (reference) cards exist to hover/focus
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(btn('Show reference nodes and links'))
    await waitFor(() => expect(spies.fitView).toHaveBeenCalled())
    // Let the post-drill-in refit settle before counting calls.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    spies.fitView.mockClear()
    const nodesBefore = nodes()
    const positionsBefore = positions()
    for (const label of ['login', 'admin', 'Role A', 'foo']) {
      fireEvent.mouseEnter(card(label))
      fireEvent.focus(card(label))
      fireEvent.mouseLeave(card(label))
      fireEvent.blur(card(label))
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(spies.fitView).not.toHaveBeenCalled()
    expect(spies.setViewport).not.toHaveBeenCalled()
    expect(nodes()).toBe(nodesBefore)
    expect(positions()).toEqual(positionsBefore)
  })

  it('clears a stale emphasis when the reference, layout, completed filter or user changes', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items and reference start hidden by default; show both so the
    // login/admin cards exist and the reference toggle can flip to "Hide"
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.mouseEnter(card('login'))
    expect(emphasized()).toHaveLength(0)
    expect(edges().some((e) => e.source === 'user:u1')).toBe(false)
    fireEvent.click(btn('Hide reference nodes and links'))
    expect(edges()).toHaveLength(0)

    fireEvent.focus(card('admin'))
    // layout now starts in TB; clicking "Layout: horizontal" changes layout (to LR)
    fireEvent.click(btn('Layout: horizontal'))
    expect(edges().some((e) => e.source === 'user:u1')).toBe(false)

    fireEvent.mouseEnter(card('Role A'))
    fireEvent.click(btn('Hide completed items'))
    expect(edges().some((e) => e.source === 'user:u1')).toBe(false)
    fireEvent.click(btn(/^Show completed items/))

    fireEvent.mouseEnter(card('admin'))
    fireEvent.click(screen.getByRole('button', { name: /back to all users/i }))
    fireEvent.click(btn('Show access for User One'))
    expect(emphasized()).toHaveLength(0)
    expect(edges().some((e) => e.source === 'user:u1')).toBe(false)
  })

  it('does not emphasize anything in the user grid', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    const gridCard = screen.getByRole('button', { name: 'Show access for User One' })
    fireEvent.mouseEnter(gridCard)
    fireEvent.focus(gridCard)
    expect(edges()).toHaveLength(0)
  })

  it('emphasizes on hover and on keyboard focus (no hover tooltip)', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them so login/admin cards appear
    fireEvent.click(btn(/^Show completed items/))
    const login = card('login')
    fireEvent.mouseEnter(login)
    // The hover tooltip was removed, and the user link is not drawn.
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(emphasized()).toHaveLength(0)
    expect(edges().some((e) => e.source === 'user:u1')).toBe(false)
    fireEvent.mouseLeave(login)

    const admin = card('admin')
    fireEvent.focus(admin)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(emphasized()).toHaveLength(0)
  })
})
