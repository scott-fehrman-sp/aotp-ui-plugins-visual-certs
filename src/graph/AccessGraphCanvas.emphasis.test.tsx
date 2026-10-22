import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Edge, Node } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { AccessGraphCanvas } from './AccessGraphCanvas'
import { CARD_Z_INDEX } from './buildAccessScene'
import { DIM_REFERENCE_OPACITY, DIM_STATUS_OPACITY, EMPHASIS_EDGE_Z_INDEX } from './emphasizeEdges'

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
const nodeId = (label: string) =>
  nodes().find((n) => (n.data as { label: string }).label === label)!.id
const emphasized = () => edges().filter((e) => e.className?.includes('vc-graph-edge-emphasized'))
const snapshot = () => structuredClone(edges())
const positions = () => nodes().map((n) => ({ id: n.id, ...n.position }))
const isStatus = (e: Edge) => Boolean((e.data as { reviewStatus?: string } | undefined)?.reviewStatus)

describe('AccessGraphCanvas hover / focus edge emphasis', () => {
  beforeEach(() => {
    spies.fitView.mockClear()
    spies.setViewport.mockClear()
  })

  it('raises and dims on hover, and restores the exact edges on leave', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    const before = snapshot()
    const login = card('login')
    fireEvent.mouseEnter(login)
    const raised = emphasized()
    expect(raised).toHaveLength(1)
    expect(raised[0].target).toBe(nodeId('login'))
    expect(raised[0].zIndex).toBe(EMPHASIS_EDGE_Z_INDEX)
    expect(raised[0].zIndex).toBeGreaterThan(CARD_Z_INDEX)
    const others = edges().filter((e) => e !== raised[0])
    expect(others.length).toBeGreaterThan(0)
    for (const e of others) {
      expect(e.style?.opacity).toBe(isStatus(e) ? DIM_STATUS_OPACITY : DIM_REFERENCE_OPACITY)
    }
    fireEvent.mouseLeave(login)
    expect(emphasized()).toHaveLength(0)
    expect(edges()).toEqual(before)
  })

  it('emphasizes on focus and restores on blur', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    const before = snapshot()
    const admin = card('admin')
    fireEvent.focus(admin)
    expect(emphasized().map((e) => e.target)).toEqual([nodeId('admin')])
    fireEvent.blur(admin)
    expect(emphasized()).toHaveLength(0)
    expect(edges()).toEqual(before)
  })

  it('leaves the edges prop untouched when hovering a reference-only node', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    const edgesBefore = edges()
    const reference = card('foo')
    expect(reference.className).toContain('vc-graph-card-reference')
    fireEvent.mouseEnter(reference)
    fireEvent.focus(reference)
    expect(edges()).toBe(edgesBefore)
  })

  it('prefers the pointer over focus and falls back to focus after the pointer leaves', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    const login = card('login')
    const admin = card('admin')
    fireEvent.focus(admin)
    fireEvent.mouseEnter(login)
    expect(emphasized().map((e) => e.target)).toEqual([nodeId('login')])
    fireEvent.mouseLeave(login)
    expect(emphasized().map((e) => e.target)).toEqual([nodeId('admin')])
    fireEvent.blur(admin)
    expect(emphasized()).toHaveLength(0)
  })

  it('a late leave of an older card does not clear a newer hover', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    const login = card('login')
    const admin = card('admin')
    fireEvent.mouseEnter(login)
    fireEvent.mouseEnter(admin)
    fireEvent.mouseLeave(login)
    expect(emphasized().map((e) => e.target)).toEqual([nodeId('admin')])
  })

  it('works with reference hidden and in the vertical layout', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    fireEvent.click(btn('Hide reference nodes and links'))
    expect(edges().every(isStatus)).toBe(true)
    fireEvent.mouseEnter(card('admin'))
    expect(emphasized().map((e) => e.target)).toEqual([nodeId('admin')])
    expect(edges().filter((e) => e.style?.opacity === DIM_STATUS_OPACITY)).toHaveLength(
      edges().length - 1,
    )
    fireEvent.mouseLeave(card('admin'))
    fireEvent.click(btn('Layout: vertical'))
    const raisedTb = () => {
      fireEvent.mouseEnter(card('Role A'))
      return emphasized()
    }
    const out = raisedTb()
    expect(out.map((e) => e.target)).toEqual([nodeId('Role A')])
    expect(out[0].targetHandle).toBe('top-in')
  })

  it('never refits, re-viewports or moves a node on hover or focus', async () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
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
    fireEvent.mouseEnter(card('login'))
    expect(emphasized()).toHaveLength(1)
    fireEvent.click(btn('Hide reference nodes and links'))
    expect(emphasized()).toHaveLength(0)
    expect(edges().some((e) => e.style?.opacity !== undefined)).toBe(false)

    fireEvent.focus(card('admin'))
    expect(emphasized()).toHaveLength(1)
    fireEvent.click(btn('Layout: vertical'))
    expect(emphasized()).toHaveLength(0)

    fireEvent.mouseEnter(card('Role A'))
    expect(emphasized().length).toBeGreaterThan(0)
    fireEvent.click(btn('Hide completed items'))
    expect(emphasized()).toHaveLength(0)
    expect(edges().some((e) => e.style?.opacity !== undefined)).toBe(false)
    fireEvent.click(btn(/^Show completed items/))

    fireEvent.mouseEnter(card('admin'))
    expect(emphasized()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /back to all users/i }))
    fireEvent.click(btn('Show access for User One'))
    expect(emphasized()).toHaveLength(0)
    expect(edges().some((e) => e.style?.opacity !== undefined)).toBe(false)
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
    const login = card('login')
    fireEvent.mouseEnter(login)
    // The hover tooltip was removed; only the edge emphasis responds.
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(emphasized()).toHaveLength(1)
    fireEvent.mouseLeave(login)
    expect(emphasized()).toHaveLength(0)

    const admin = card('admin')
    fireEvent.focus(admin)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(emphasized()).toHaveLength(1)
  })
})
