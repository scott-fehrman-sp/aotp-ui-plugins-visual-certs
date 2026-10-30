import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Edge, Node } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFixtureGraph, statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import type { AccessGraphData } from '../sailpoint/types'
import { AccessGraphCanvas } from './AccessGraphCanvas'
import { DIM_REFERENCE_OPACITY, DIM_STATUS_OPACITY } from './emphasizeEdges'
import {
  LINEAGE_EDGE_CLASS,
  LINEAGE_STROKE_WIDTH,
  SELECTED_EDGE_CLASS,
  STATUS_STROKE,
} from './selectEdges'

// A separate file so wrapping ReactFlow (to record the nodes/edges it is given)
// and mocking fitView / setViewport leaves the other canvas tests untouched.
// jsdom cannot paint or lay out, so this asserts the DATA handed to React Flow,
// the card DOM/aria/classes, and that selecting never refits or moves anything;
// the painting is checked in a real browser.
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

/**
 * User One: role-a{ap-foo{e1}} needsReview -> engr db; login approved and admin
 * revoked held directly, both -> phone app. User Two: pay (needsReview) -> erp.
 */
function graph(): AccessGraphData {
  return statusGraph([
    row({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-a', accessItemName: 'Role A' }),
    row({ id: '2', entitlement: 'login', entitlementId: 'e2', source: 'phone app', sourceId: 's2', reviewStatus: 'approved', accessItemKind: 'entitlement', accessItemId: 'e2', accessItemName: 'login' }),
    row({ id: '3', entitlement: 'admin', entitlementId: 'e3', source: 'phone app', sourceId: 's2', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e3', accessItemName: 'admin' }),
    row({ id: '4', userId: 'u2', user: 'User Two', entitlement: 'pay', entitlementId: 'e4', source: 'erp', sourceId: 's3', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: 'e4', accessItemName: 'pay' }),
  ])
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name })
const edges = () => spies.edges as Edge[]
const nodes = () => spies.nodes as Node[]
const card = (label: string) => screen.getByText(label).closest<HTMLElement>('.vc-graph-card')!
const drillIn = (user = 'User One') => fireEvent.click(btn(`Show access for ${user}`))
const eid = (from: string, to: string) => `e:${from}:${to}`
const withClass = (name: string) => edges().filter((e) => e.className?.includes(name))
const selectedEdges = () => withClass(SELECTED_EDGE_CLASS)
const lineageEdges = () => withClass(LINEAGE_EDGE_CLASS)
const emphasized = () => withClass('vc-graph-edge-emphasized')
const snapshot = () => structuredClone(edges())
const positions = () => nodes().map((n) => ({ id: n.id, ...n.position }))
const isStatus = (e: Edge) => Boolean((e.data as { reviewStatus?: string } | undefined)?.reviewStatus)
const pressed = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.vc-graph-card[aria-pressed="true"]'))
const liveText = () =>
  Array.from(document.querySelectorAll('[aria-live]'))
    .map((el) => el.textContent)
    .join('|')
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })

describe('AccessGraphCanvas item selection', () => {
  beforeEach(() => {
    spies.fitView.mockClear()
    spies.setViewport.mockClear()
  })

  it('makes first-level cards toggle buttons that keep their names', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items and reference start hidden by default; show both so the
    // login/admin (completed) and reference cards are present to assert on
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(btn('Show reference nodes and links'))
    for (const [kind, label] of [['Role', 'Role A'], ['Entitlement', 'login'], ['Entitlement', 'admin']]) {
      const button = btn(`${kind}: ${label}`)
      expect(button).toBe(screen.getByLabelText(`${kind}: ${label}`))
      expect(button).toHaveAttribute('aria-pressed', 'false')
      // The corner icon is described by the card so role=button keeps announcing the status.
      const described = button.getAttribute('aria-describedby')!
      expect(document.getElementById(described)).toHaveAttribute('data-review-status')
      expect(document.getElementById(described)).toHaveAccessibleName(/needs review|approved|revoked/i)
    }
    // Reference-only cards are toggle buttons too, so their links can be highlighted.
    for (const [kind, label] of [
      ['Access profile', 'foo'],
      ['Entitlement', 'read'],
      ['Source', 'engr db'],
      ['Source', 'phone app'],
    ]) {
      const button = btn(`${kind}: ${label}`)
      expect(button).toBe(card(label))
      expect(button).toHaveAttribute('aria-pressed', 'false')
    }
    // The user card is not a selection button.
    const user = card('User One')
    expect(user).not.toHaveAttribute('role')
    expect(user).not.toHaveAttribute('aria-pressed')
  })

  it('keeps the grid user cards as plain drill-in buttons', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    const gridCard = btn('Show access for User One')
    expect(gridCard).not.toHaveAttribute('aria-pressed')
    fireEvent.click(gridCard)
    expect(card('Role A')).toBeInTheDocument()
  })

  it('click selects and highlights the lineage, without a link from the user; click again clears', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // reference and completed items start hidden by default; show both so Role A's
    // reference lineage exists and the completed items' links are present to dim
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(btn(/^Show completed items/))
    const before = snapshot()
    const roleA = card('Role A')
    fireEvent.click(roleA)

    expect(roleA).toHaveAttribute('aria-pressed', 'true')
    expect(roleA.className).toContain('vc-graph-card-selected')
    expect(pressed()).toEqual([roleA])
    expect(selectedEdges()).toHaveLength(0)
    expect(edges().some((e) => e.source === 'user:u1')).toBe(false)

    expect(lineageEdges().map((e) => e.id).sort()).toEqual(
      [
        eid('role:role-a', 'accessProfile:ap-foo'),
        eid('accessProfile:ap-foo', 'entitlement:e1'),
        eid('entitlement:e1', 'source:s1'),
      ].sort(),
    )
    for (const e of lineageEdges()) {
      expect(e.style).toMatchObject({
        stroke: STATUS_STROKE.needsReview,
        strokeWidth: LINEAGE_STROKE_WIDTH,
        opacity: 1,
      })
      expect(e.className).toContain(LINEAGE_EDGE_CLASS)
    }
    const highlighted = new Set(lineageEdges().map((e) => e.id))
    const others = edges().filter((e) => !highlighted.has(e.id))
    expect(others.length).toBeGreaterThan(0)
    for (const e of others) {
      expect(e.style?.opacity).toBe(isStatus(e) ? DIM_STATUS_OPACITY : DIM_REFERENCE_OPACITY)
    }

    fireEvent.click(roleA)
    expect(roleA).toHaveAttribute('aria-pressed', 'false')
    expect(selectedEdges()).toHaveLength(0)
    expect(edges()).toEqual(before)
  })

  it('selecting another item replaces the selection; a shared downstream edge follows the selection', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items and reference start hidden by default; show both so the
    // login/admin cards exist and share the phone app (s2) reference lineage
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(card('login'))
    expect(lineageEdges().map((e) => e.id)).toEqual([eid('entitlement:e2', 'source:s2')])
    fireEvent.click(card('admin'))
    expect(pressed()).toEqual([card('admin')])
    expect(selectedEdges()).toHaveLength(0)
    expect(lineageEdges().map((e) => e.id)).toEqual([eid('entitlement:e3', 'source:s2')])
    expect(
      edges().find((e) => e.id === eid('entitlement:e2', 'source:s2'))!.style?.opacity,
    ).toBe(DIM_REFERENCE_OPACITY)
  })

  it('Enter and Space toggle the focused card, and Space does not scroll the pane', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them so the revoked `admin` card appears
    fireEvent.click(btn(/^Show completed items/))
    const admin = card('admin')
    admin.focus()
    expect(fireEvent.keyDown(admin, { key: 'Enter' })).toBe(false)
    expect(admin).toHaveAttribute('aria-pressed', 'true')
    expect(fireEvent.keyDown(admin, { key: ' ' })).toBe(false)
    expect(admin).toHaveAttribute('aria-pressed', 'false')
    fireEvent.keyDown(admin, { key: ' ' })
    expect(admin).toHaveAttribute('aria-pressed', 'true')
    // Other keys do nothing.
    expect(fireEvent.keyDown(admin, { key: 'a' })).toBe(true)
    fireEvent.keyDown(admin, { key: 'Tab' })
    expect(admin).toHaveAttribute('aria-pressed', 'true')
  })

  it('highlights the path through a reference-only card, and ignores the user card', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items and reference start hidden by default; show both so the
    // nested path and the unrelated completed items are present
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(btn('Show reference nodes and links'))
    const edgesBefore = edges()
    fireEvent.click(card('User One'))
    fireEvent.keyDown(card('User One'), { key: 'Enter' })
    expect(edges()).toBe(edgesBefore)
    expect(pressed()).toHaveLength(0)

    fireEvent.click(card('engr db'))
    expect(pressed()).toEqual([card('engr db')])
    expect(lineageEdges().map((e) => e.id).sort()).toEqual(
      [
        eid('role:role-a', 'accessProfile:ap-foo'),
        eid('accessProfile:ap-foo', 'entitlement:e1'),
        eid('entitlement:e1', 'source:s1'),
      ].sort(),
    )
    // The unrelated login → phone app link is dimmed, not highlighted.
    expect(edges().find((e) => e.id === eid('entitlement:e2', 'source:s2'))?.style?.opacity).toBe(
      DIM_REFERENCE_OPACITY,
    )
    expect(card('foo').className).toContain('vc-graph-card-lineage')
    expect(card('phone app').className).toContain('vc-graph-card-reference-dim')

    fireEvent.click(card('engr db'))
    expect(pressed()).toHaveLength(0)
    expect(lineageEdges()).toHaveLength(0)

    fireEvent.keyDown(card('read'), { key: 'Enter' })
    expect(pressed()).toEqual([card('read')])
    expect(lineageEdges().map((e) => e.id)).toContain(eid('entitlement:e1', 'source:s1'))
    expect(lineageEdges().map((e) => e.id)).toContain(eid('accessProfile:ap-foo', 'entitlement:e1'))
    fireEvent.keyDown(card('read'), { key: ' ' })
    expect(pressed()).toHaveLength(0)
  })

  it('does not use React Flow element selection (no competing .selected visual)', () => {
    const { container } = render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items and reference start hidden by default; show both so the
    // login (completed) and foo (reference) cards exist to click
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(card('login'))
    fireEvent.click(card('foo'))
    expect(container.querySelector('.react-flow__node.selected')).toBeNull()
    expect(container.querySelector('.react-flow__node.selectable')).toBeNull()
    expect(container.querySelector('.react-flow__edge.selected')).toBeNull()
  })

  it('clears on a pane click and announces it', () => {
    const { container } = render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them so the `login` card appears
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('login'))
    expect(pressed()).toHaveLength(1)
    fireEvent.click(container.querySelector('.react-flow__pane')!)
    expect(pressed()).toHaveLength(0)
    expect(selectedEdges()).toHaveLength(0)
    expect(liveText()).toContain('Selection cleared.')
  })

  it('a pane click with nothing selected leaves the edges alone', () => {
    const { container } = render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    const before = edges()
    fireEvent.click(container.querySelector('.react-flow__pane')!)
    expect(edges()).toBe(before)
  })

  it('Escape clears the selection first and only the next Escape returns to the grid', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them so the `login` card appears
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('login'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(pressed()).toHaveLength(0)
    expect(card('login')).toBeInTheDocument()
    expect(liveText()).toContain('Selection cleared.')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(btn('Show access for User One')).toBeInTheDocument()
  })

  it('a single Escape returns to the grid when nothing is selected, also with a hosted back button', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    render(<AccessGraphCanvas graph={graph()} backSlot={host} />)
    drillIn()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(btn('Show access for User One')).toBeInTheDocument()
    host.remove()
  })

  it('ignores Escape typed in an input', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them so the `login` card appears
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('login'))
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(pressed()).toHaveLength(1)
    input.remove()
  })

  it('clears the selection on Back to all users and when another user is opened', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them (the preference persists
    // across user switches) so the `login` card is available to select
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('login'))
    fireEvent.click(screen.getByRole('button', { name: '← All Users' }))
    drillIn()
    expect(pressed()).toHaveLength(0)
    expect(selectedEdges()).toHaveLength(0)

    fireEvent.click(card('login'))
    fireEvent.click(screen.getByRole('button', { name: '← All Users' }))
    drillIn('User Two')
    expect(pressed()).toHaveLength(0)
    expect(selectedEdges()).toHaveLength(0)
    expect(edges().some((e) => e.style?.opacity === DIM_STATUS_OPACITY)).toBe(false)
  })

  it('clears the selection (and returns to the grid) when the node set changes', () => {
    const { rerender } = render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them so the `login` card appears
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('login'))
    rerender(<AccessGraphCanvas graph={graph()} />)
    expect(btn('Show access for User One')).toBeInTheDocument()
    drillIn()
    expect(pressed()).toHaveLength(0)
    expect(selectedEdges()).toHaveLength(0)
  })

  it('keeps the selection across layout, minimap and reference toggles', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // reference and minimap start hidden by default; show both to capture the
    // shown baseline this test toggles against (Role A keeps its full lineage)
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(btn('Show minimap'))
    // layout now starts in TB; switch to horizontal so `full` is the horizontal baseline
    fireEvent.click(btn('Layout: horizontal'))
    fireEvent.click(card('Role A'))
    const full = snapshot()

    fireEvent.click(btn('Layout: vertical'))
    expect(pressed()).toEqual([card('Role A')])
    expect(lineageEdges()).toHaveLength(3)
    expect(lineageEdges().every((e) => e.targetHandle === 'top-in')).toBe(true)

    fireEvent.click(btn('Hide minimap'))
    expect(pressed()).toEqual([card('Role A')])
    fireEvent.click(btn('Show minimap'))
    fireEvent.click(btn('Layout: horizontal'))
    expect(edges()).toEqual(full)

    // Reference hidden: the user links stay hidden, so nothing is drawn.
    fireEvent.click(btn('Hide reference nodes and links'))
    expect(pressed()).toEqual([card('Role A')])
    expect(selectedEdges()).toHaveLength(0)
    expect(lineageEdges()).toHaveLength(0)
    expect(edges()).toHaveLength(0)

    // Reference shown again: the whole path is back, selection kept.
    fireEvent.click(btn('Show reference nodes and links'))
    expect(pressed()).toEqual([card('Role A')])
    expect(edges()).toEqual(full)
  })

  it('keeps the selection and recolors it across a status-only refresh', () => {
    const base = graph()
    const { rerender } = render(<AccessGraphCanvas graph={base} />)
    drillIn()
    // reference starts hidden by default; show it so Role A's lineage edges exist.
    // completed items start hidden too; show them so Role A stays visible after
    // the refresh flips its status to approved (completed).
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('Role A'))
    expect(lineageEdges()[0].style?.stroke).toBe('var(--vc-warn)')
    const refreshed: AccessGraphData = {
      nodes: base.nodes,
      edges: base.edges.map((e) =>
        e.to === 'role:role-a' ? { ...e, reviewStatus: 'approved' as const } : e,
      ),
    }
    rerender(<AccessGraphCanvas graph={refreshed} />)
    expect(pressed()).toEqual([card('Role A')])
    expect(lineageEdges()).toHaveLength(3)
    for (const e of lineageEdges()) expect(e.style?.stroke).toBe('var(--vc-allow)')
  })

  it('previews a different hovered or focused item while the selection stays highlighted', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items and reference start hidden by default; show both so the
    // admin/login (completed) and foo (reference) cards exist to preview
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(card('Role A'))
    const plain = snapshot()

    fireEvent.mouseEnter(card('admin'))
    expect(emphasized()).toHaveLength(0)
    expect(lineageEdges()).toHaveLength(3)
    fireEvent.mouseLeave(card('admin'))
    expect(edges()).toEqual(plain)

    fireEvent.focus(card('login'))
    expect(emphasized()).toHaveLength(0)
    fireEvent.blur(card('login'))
    expect(edges()).toEqual(plain)

    // The selected item itself and reference cards add nothing.
    fireEvent.mouseEnter(card('Role A'))
    fireEvent.focus(card('foo'))
    expect(edges()).toEqual(plain)
  })

  it('marks lineage reference cards and mutes the other reference cards, with no extra icons', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // reference and completed items start hidden by default; show both so Role A's
    // lineage reference cards and the phone app source (under the completed items) appear
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('Role A'))
    for (const label of ['foo', 'read', 'engr db']) {
      expect(card(label).className).toContain('vc-graph-card-lineage')
      expect(card(label).className).not.toContain('vc-graph-card-reference-dim')
    }
    expect(card('phone app').className).toContain('vc-graph-card-reference-dim')
    expect(card('phone app').className).not.toContain('vc-graph-card-lineage')
    for (const label of ['foo', 'read', 'engr db', 'phone app']) {
      expect(card(label).querySelector('.vc-graph-status-icon')).toBeNull()
    }
    // The selected card keeps its single status icon and status class.
    expect(card('Role A').querySelectorAll('.vc-graph-status-icon')).toHaveLength(1)
    expect(card('Role A').className).toContain('vc-graph-card-status-needsReview')
    // Other first-level cards are untouched.
    expect(card('login').className).not.toMatch(/lineage|reference-dim|selected/)

    fireEvent.click(card('Role A'))
    for (const label of ['foo', 'read', 'engr db', 'phone app']) {
      expect(card(label).className).not.toMatch(/lineage|reference-dim/)
    }
  })

  it('announces the selection and its removal in the live region', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    fireEvent.click(card('Role A'))
    expect(liveText()).toContain('Highlighting the links for Role A. Press Escape to clear.')
    fireEvent.click(card('Role A'))
    expect(liveText()).toContain('Selection cleared.')
  })

  it('never refits, re-viewports or moves a node when selecting, deselecting or previewing', async () => {
    const { container } = render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them so login/admin cards exist
    fireEvent.click(btn(/^Show completed items/))
    await waitFor(() => expect(spies.fitView).toHaveBeenCalled())
    await settle()
    spies.fitView.mockClear()
    spies.setViewport.mockClear()
    const nodesBefore = nodes()
    const positionsBefore = positions()
    for (const label of ['login', 'admin', 'Role A']) {
      fireEvent.click(card(label))
      fireEvent.mouseEnter(card('login'))
      fireEvent.mouseLeave(card('login'))
      fireEvent.keyDown(card(label), { key: 'Enter' })
    }
    fireEvent.click(card('login'))
    fireEvent.click(container.querySelector('.react-flow__pane')!)
    fireEvent.click(card('admin'))
    fireEvent.keyDown(window, { key: 'Escape' }) // clears; stays in the drill-down
    await settle()
    expect(spies.fitView).not.toHaveBeenCalled()
    expect(spies.setViewport).not.toHaveBeenCalled()
    expect(nodes()).toBe(nodesBefore)
    expect(positions()).toEqual(positionsBefore)
  })

  it('does not select anything in the user grid', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    const grid = btn('Show access for User One')
    fireEvent.keyDown(grid, { key: 'Escape' })
    expect(within(document.body).queryByText(/Highlighting the links/)).toBeNull()
    expect(edges()).toHaveLength(0)
  })

  it('selects a card and shows its description tooltip on hover', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them so the `login` card appears
    fireEvent.click(btn(/^Show completed items/))
    const login = card('login')
    fireEvent.click(login)
    fireEvent.mouseEnter(login)
    expect(login).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Description not set')
  })
})

describe('AccessGraphCanvas selection: an item both first-level and nested', () => {
  it('Role A highlights the nested path to Read but not the user -> Read edge; Read highlights its attribute and source', async () => {
    render(<AccessGraphCanvas graph={await buildFixtureGraph()} />)
    fireEvent.click(btn('Show access for Alice Adams'))
    // completed items and reference start hidden by default; show both so the
    // completed Role A / Read items and their nested path are present to select
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(btn('Show reference nodes and links'))

    fireEvent.click(card('Role A'))
    const ids = new Set(lineageEdges().map((e) => e.id))
    expect(ids.has(eid('accessProfile:ap-foo', 'entitlement:e-read'))).toBe(true)
    expect(ids.has(eid('entitlement:e-read', 'attribute:s-erp:memberOf'))).toBe(true)
    expect(ids.has(eid('attribute:s-erp:memberOf', 'source:s-erp'))).toBe(true)
    expect(edges().some((e) => e.id === eid('user:u-a', 'entitlement:e-read'))).toBe(false)

    fireEvent.click(card('Read'))
    expect(pressed()).toEqual([card('Read')])
    expect(selectedEdges()).toHaveLength(0)
    expect(lineageEdges().map((e) => e.id).sort()).toEqual(
      [
        eid('entitlement:e-read', 'attribute:s-erp:memberOf'),
        eid('attribute:s-erp:memberOf', 'source:s-erp'),
      ].sort(),
    )
    expect(
      edges().find((edge) => edge.id === eid('entitlement:e-read', 'attribute:s-erp:memberOf'))
        ?.style?.stroke,
    ).toBe(STATUS_STROKE.approved)
    expect(
      edges().find((edge) => edge.id === eid('attribute:s-erp:memberOf', 'source:s-erp'))?.style
        ?.stroke,
    ).toBe('var(--edge)')
    const upstream = edges().find((e) => e.id === eid('accessProfile:ap-foo', 'entitlement:e-read'))!
    expect(upstream.style?.opacity).toBe(DIM_REFERENCE_OPACITY)
  })

  it('colors every access-item → attribute edge with that access item when the attribute is selected', async () => {
    render(<AccessGraphCanvas graph={await buildFixtureGraph()} />)
    fireEvent.click(btn('Show access for Alice Adams'))
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(btn('Show reference nodes and links'))

    const attribute = document.querySelector(
      '[data-id="attribute:s-erp:memberOf"] .vc-graph-card',
    )
    expect(attribute).toBeTruthy()
    fireEvent.click(attribute!)

    const strokeOf = (from: string, to: string) =>
      edges().find((edge) => edge.id === eid(from, to))?.style?.stroke
    // Read is reviewed itself (approved), so its hop stays green even though
    // Role A, which also contains it, is reassigned.
    expect(strokeOf('entitlement:e-read', 'attribute:s-erp:memberOf')).toBe(STATUS_STROKE.approved)
    // Pay is only reached through Billing, which still needs review.
    expect(strokeOf('entitlement:e-pay', 'attribute:s-erp:memberOf')).toBe(STATUS_STROKE.needsReview)
    // Write and Delete have no review of their own; they take Role A’s color.
    expect(strokeOf('entitlement:e-write', 'attribute:s-erp:memberOf')).toBe(
      STATUS_STROKE.reassigned,
    )
    expect(strokeOf('entitlement:e-del', 'attribute:s-erp:memberOf')).toBe(STATUS_STROKE.reassigned)
    // The next hop, from each access item to the reference node, uses that item.
    expect(strokeOf('accessProfile:ap-bill', 'entitlement:e-pay')).toBe(STATUS_STROKE.needsReview)
    expect(strokeOf('role:role-a', 'accessProfile:ap-foo')).toBe(STATUS_STROKE.reassigned)
    expect(strokeOf('role:role-a', 'entitlement:e-del')).toBe(STATUS_STROKE.reassigned)
    expect(strokeOf('accessProfile:ap-foo', 'entitlement:e-write')).toBe(STATUS_STROKE.reassigned)
    expect(strokeOf('accessProfile:ap-foo', 'entitlement:e-read')).toBe(STATUS_STROKE.approved)
    // The hop out of the attribute is the only highlighted edge that stays muted.
    expect(strokeOf('attribute:s-erp:memberOf', 'source:s-erp')).toBe('var(--edge)')
    expect(
      edges().find((edge) => edge.id === eid('entitlement:e-read', 'attribute:s-erp:memberOf'))
        ?.className,
    ).toContain(LINEAGE_EDGE_CLASS)
  })
})

/** True when the selection dims any edge (the base reference opacity is not a dim). */
const anyDimmed = () =>
  edges().some(
    (e) => e.style?.opacity === DIM_STATUS_OPACITY || e.style?.opacity === DIM_REFERENCE_OPACITY,
  )

describe('AccessGraphCanvas selection with the completed filter', () => {
  it('keeps a visible item selected across hide and show, recomputing the highlight from the filtered edges', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // reference and completed items start hidden by default; show both so the
    // full scene (Role A lineage plus the completed items) is the baseline that
    // hide/show completed round-trips back to
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('Role A'))
    const full = snapshot()

    fireEvent.click(btn('Hide completed items'))
    expect(pressed()).toEqual([card('Role A')])
    expect(edges().some((e) => e.source === 'user:u1')).toBe(false)
    expect(lineageEdges()).toHaveLength(3)
    // Only the visible lineage is left: nothing is dimmed.
    expect(edges()).toHaveLength(3)
    expect(anyDimmed()).toBe(false)

    fireEvent.click(btn(/^Show completed items/))
    expect(pressed()).toEqual([card('Role A')])
    expect(edges()).toEqual(full)
  })

  it('clears the selection of an item that gets hidden, and does not restore it on show', () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    // completed items start hidden by default; show them so `login` can be
    // selected before being hidden again
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('login'))
    expect(pressed()).toEqual([card('login')])

    fireEvent.click(btn('Hide completed items'))
    expect(pressed()).toHaveLength(0)
    expect(selectedEdges()).toHaveLength(0)
    expect(lineageEdges()).toHaveLength(0)
    expect(anyDimmed()).toBe(false)
    expect(liveText()).toContain('Completed items hidden (2).')
    expect(liveText()).not.toContain('Highlighting the links')

    fireEvent.click(btn(/^Show completed items/))
    expect(pressed()).toHaveLength(0)
    expect(selectedEdges()).toHaveLength(0)
    expect(anyDimmed()).toBe(false)
  })

  it('clears the selection of a first-level item that survives only as nested reference (fixture: Read)', async () => {
    render(<AccessGraphCanvas graph={await buildFixtureGraph()} />)
    fireEvent.click(btn('Show access for Alice Adams'))
    // completed items start hidden by default; show them so the approved `Read`
    // card is present to select before hiding completed again
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('Read'))
    expect(pressed()).toEqual([card('Read')])
    fireEvent.click(btn('Hide completed items'))
    // Role A is completed too, so Read is not even reachable any more.
    expect(screen.queryByText('Read')).toBeNull()
    expect(pressed()).toHaveLength(0)
    fireEvent.click(btn(/^Show completed items/))
    expect(pressed()).toHaveLength(0)
    expect(btn('Entitlement: Read')).toHaveAttribute('aria-pressed', 'false')
  })

  it('clears the selection when a status-only refresh completes the selected item while completed items are hidden', () => {
    const base = graph()
    const { rerender } = render(<AccessGraphCanvas graph={base} />)
    drillIn()
    // completed items start hidden by default, which is the precondition here;
    // Role A is needsReview so it stays visible and selectable
    fireEvent.click(card('Role A'))
    expect(pressed()).toEqual([card('Role A')])
    const refreshed: AccessGraphData = {
      nodes: base.nodes,
      edges: base.edges.map((e) =>
        e.to === 'role:role-a' ? { ...e, reviewStatus: 'approved' as const } : e,
      ),
    }
    rerender(<AccessGraphCanvas graph={refreshed} />)
    expect(screen.queryByText('Role A')).toBeNull()
    expect(pressed()).toHaveLength(0)
    fireEvent.click(btn(/^Show completed items/))
    expect(pressed()).toHaveLength(0)
  })
})

/**
 * User One holds two items that need review (Role A and vpn) plus one approved
 * entitlement. Only the needs-review pair may be selected together.
 */
function needsReviewPair(): AccessGraphData {
  return statusGraph([
    row({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-a', accessItemName: 'Role A' }),
    row({ id: '5', entitlement: 'vpn', entitlementId: 'e5', source: 'vpn gw', sourceId: 's5', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: 'e5', accessItemName: 'vpn' }),
    row({ id: '2', entitlement: 'login', entitlementId: 'e2', source: 'phone app', sourceId: 's2', reviewStatus: 'approved', accessItemKind: 'entitlement', accessItemId: 'e2', accessItemName: 'login' }),
  ])
}

const pressedLabels = () => pressed().map((el) => el.getAttribute('aria-label')).sort()
const shiftClick = (el: HTMLElement) => fireEvent.click(el, { shiftKey: true })

describe('AccessGraphCanvas needs-review multi-select', () => {
  beforeEach(() => {
    spies.fitView.mockClear()
    spies.setViewport.mockClear()
  })

  it('keeps every shift-clicked needs-review item selected and highlights each lineage', () => {
    render(<AccessGraphCanvas graph={needsReviewPair()} />)
    drillIn()
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('Role A'))
    shiftClick(card('vpn'))

    expect(pressedLabels()).toEqual(['Entitlement: vpn', 'Role: Role A'])
    expect(card('login')).toHaveAttribute('aria-pressed', 'false')
    expect(lineageEdges().map((e) => e.id).sort()).toEqual(
      [
        eid('role:role-a', 'accessProfile:ap-foo'),
        eid('accessProfile:ap-foo', 'entitlement:e1'),
        eid('entitlement:e1', 'source:s1'),
        eid('entitlement:e5', 'source:s5'),
      ].sort(),
    )
    for (const edge of lineageEdges()) {
      expect(edge.style?.stroke).toBe(STATUS_STROKE.needsReview)
    }
    expect(edges().find((e) => e.id === eid('entitlement:e2', 'source:s2'))?.style?.opacity).toBe(
      DIM_REFERENCE_OPACITY,
    )
    expect(liveText()).toContain('vpn added to the selection. 2 items selected. Press Escape to clear.')

    shiftClick(card('Role A'))
    expect(pressedLabels()).toEqual(['Entitlement: vpn'])
    expect(lineageEdges().map((e) => e.id)).toEqual([eid('entitlement:e5', 'source:s5')])
    expect(liveText()).toContain('Role A removed from the selection. 1 item selected. Press Escape to clear.')
  })

  it('a plain click on a second needs-review item replaces the selection', () => {
    render(<AccessGraphCanvas graph={needsReviewPair()} />)
    drillIn()
    fireEvent.click(card('Role A'))
    fireEvent.click(card('vpn'))
    expect(pressedLabels()).toEqual(['Entitlement: vpn'])
    expect(liveText()).toContain('Highlighting the links for vpn. Press Escape to clear.')
  })

  it('adds a needs-review item with Shift+Enter and removes it with Shift+Space', () => {
    render(<AccessGraphCanvas graph={needsReviewPair()} />)
    drillIn()
    fireEvent.click(card('Role A'))
    const vpn = card('vpn')
    expect(fireEvent.keyDown(vpn, { key: 'Enter' })).toBe(false)
    expect(pressedLabels()).toEqual(['Entitlement: vpn'])
    fireEvent.click(card('Role A'))
    expect(fireEvent.keyDown(vpn, { key: 'Enter', shiftKey: true })).toBe(false)
    expect(pressedLabels()).toEqual(['Entitlement: vpn', 'Role: Role A'])
    expect(fireEvent.keyDown(card('Role A'), { key: ' ', shiftKey: true })).toBe(false)
    expect(pressedLabels()).toEqual(['Entitlement: vpn'])
  })

  it('lets a completed item or a reference node replace the needs-review set', () => {
    render(<AccessGraphCanvas graph={needsReviewPair()} />)
    drillIn()
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('Role A'))
    shiftClick(card('vpn'))
    fireEvent.click(card('login'))
    expect(pressedLabels()).toEqual(['Entitlement: login'])

    fireEvent.click(card('Role A'))
    expect(pressedLabels()).toEqual(['Role: Role A'])
    shiftClick(card('vpn'))
    fireEvent.click(card('engr db'))
    expect(pressedLabels()).toEqual(['Source: engr db'])
  })

  it('clears every selected needs-review item on Escape and on a pane click', () => {
    const { container } = render(<AccessGraphCanvas graph={needsReviewPair()} />)
    drillIn()
    fireEvent.click(card('Role A'))
    shiftClick(card('vpn'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(pressed()).toHaveLength(0)
    expect(screen.getByRole('button', { name: '← All Users' })).toBeInTheDocument()

    fireEvent.click(card('Role A'))
    shiftClick(card('vpn'))
    fireEvent.click(container.querySelector('.react-flow__pane')!)
    expect(pressed()).toHaveLength(0)
    expect(screen.getByRole('button', { name: '← All Users' })).toBeInTheDocument()
  })

  it('drops only the item a refresh completes while completed items are hidden', () => {
    const base = needsReviewPair()
    const { rerender } = render(<AccessGraphCanvas graph={base} />)
    drillIn()
    fireEvent.click(card('Role A'))
    shiftClick(card('vpn'))
    expect(pressed()).toHaveLength(2)
    const refreshed: AccessGraphData = {
      nodes: base.nodes,
      edges: base.edges.map((e) =>
        e.to === 'role:role-a' ? { ...e, reviewStatus: 'approved' as const } : e,
      ),
    }
    rerender(<AccessGraphCanvas graph={refreshed} />)
    expect(screen.queryByText('Role A')).toBeNull()
    expect(pressedLabels()).toEqual(['Entitlement: vpn'])
    fireEvent.click(btn(/^Show completed items/))
    expect(pressedLabels()).toEqual(['Entitlement: vpn'])
    expect(card('Role A')).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps both items selected when a refresh changes one status and completed items stay visible', () => {
    const base = needsReviewPair()
    const { rerender } = render(<AccessGraphCanvas graph={base} />)
    drillIn()
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(card('Role A'))
    shiftClick(card('vpn'))
    const refreshed: AccessGraphData = {
      nodes: base.nodes,
      edges: base.edges.map((e) =>
        e.to === 'role:role-a' ? { ...e, reviewStatus: 'approved' as const } : e,
      ),
    }
    rerender(<AccessGraphCanvas graph={refreshed} />)
    expect(pressedLabels()).toEqual(['Entitlement: vpn', 'Role: Role A'])
    const roleEdge = edges().find((e) => e.id === eid('role:role-a', 'accessProfile:ap-foo'))!
    const vpnEdge = edges().find((e) => e.id === eid('entitlement:e5', 'source:s5'))!
    expect(roleEdge.style?.stroke).toBe(STATUS_STROKE.approved)
    expect(vpnEdge.style?.stroke).toBe(STATUS_STROKE.needsReview)
  })
})
