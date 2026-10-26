import type { Edge } from '@xyflow/react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { AccessGraphCanvas } from './AccessGraphCanvas'
import { NODE_HEIGHT, NODE_WIDTH, WRAP_GAP } from './buildAccessScene'
import { LINEAGE_EDGE_CLASS, SELECTED_EDGE_CLASS } from './selectEdges'

// Separate file: spies on fitView / setViewport (to count refit plans) and
// records the edges handed to React Flow. jsdom cannot lay out, so positions are
// read from the `.react-flow__node` translate transforms (graph coordinates);
// real painting and overlap are checked in a real browser.
const spies = vi.hoisted(() => ({
  fitView: vi.fn(() => Promise.resolve(true)),
  setViewport: vi.fn(() => Promise.resolve(true)),
  edges: [] as unknown[],
}))
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  const Recorded = (props: React.ComponentProps<typeof actual.ReactFlow>) => {
    spies.edges = props.edges ?? []
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

const pad = (i: number) => String(i + 1).padStart(2, '0')

/** `n` first-level entitlements named "Ent 01".., the first `done` approved. */
function ents(n: number, done = 0): StatusRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      id: `e${pad(i)}`,
      entitlement: `Ent ${pad(i)}`,
      entitlementId: `e${pad(i)}`,
      source: 'engr db',
      sourceId: 's1',
      reviewStatus: i < done ? 'approved' : 'needsReview',
      accessItemKind: 'entitlement',
      accessItemId: `e${pad(i)}`,
      accessItemName: `Ent ${pad(i)}`,
    }),
  )
}
/** One role (first level) and one access profile (first level). */
function roleAndAp(): StatusRow[] {
  return [
    row({ id: 'r1', role: 'Role A', roleId: 'ra', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'ra', accessItemName: 'Role A' }),
    row({ id: 'a1', accessProfile: 'AP A', accessProfileId: 'apa', reviewStatus: 'needsReview', accessItemKind: 'accessProfile', accessItemId: 'apa', accessItemName: 'AP A' }),
  ]
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name })
const drillIn = () => fireEvent.click(btn('Show access for User One'))
const card = (label: string) => screen.getByText(label).closest<HTMLElement>('.vc-graph-card')!
const edges = () => spies.edges as Edge[]
const withClass = (name: string) => edges().filter((e) => e.className?.includes(name))
const plans = () => spies.fitView.mock.calls.length + spies.setViewport.mock.calls.length

/** The graph-coordinate position of the node showing `label`. */
function translate(label: string) {
  const wrapper = screen.getByText(label).closest<HTMLElement>('.react-flow__node')!
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(wrapper.style.transform)!
  return { x: Number(m[1]), y: Number(m[2]) }
}
const entPositions = (n: number) => Array.from({ length: n }, (_, i) => translate(`Ent ${pad(i)}`))
const distinct = (values: number[]) => [...new Set(values)].sort((a, b) => a - b)

describe('AccessGraphCanvas lane wrapping', () => {
  beforeEach(() => {
    spies.fitView.mockClear()
    spies.setViewport.mockClear()
  })

  it('LR: 12 entitlements form two columns, earlier lanes are not moved', () => {
    render(<AccessGraphCanvas graph={statusGraph([...roleAndAp(), ...ents(12)])} />)
    drillIn()
    // layout now starts in TB; switch to horizontal for this LR test
    fireEvent.click(btn('Layout: horizontal'))
    // reference starts hidden by default (the precondition for this wrap test)
    const pos = entPositions(12)
    const xs = distinct(pos.map((p) => p.x))
    expect(xs).toHaveLength(2)
    expect(xs[1] - xs[0]).toBe(NODE_WIDTH + WRAP_GAP)
    for (const x of xs) {
      const ys = pos.filter((p) => p.x === x).map((p) => p.y).sort((a, b) => a - b)
      expect(ys).toHaveLength(6)
      ys.forEach((y, i) => i > 0 && expect(y - ys[i - 1]).toBe(NODE_HEIGHT + 48))
    }
    // Role and access profile sit where they do with only 3 entitlements.
    const role = translate('Role A')
    const ap = translate('AP A')
    const user = translate('User One')
    expect(user.x).toBeLessThan(role.x)
    expect(role.x).toBeLessThan(ap.x)
    expect(ap.x).toBeLessThan(xs[0])
    expect(role.x).toBe(344)
    expect(ap.x).toBe(664)
    expect(xs[0]).toBe(984)
  })

  it('TB: 12 entitlements form two rows of six', () => {
    render(<AccessGraphCanvas graph={statusGraph([...roleAndAp(), ...ents(12)])} />)
    drillIn()
    // reference starts hidden by default (the precondition for this wrap test)
    // layout now starts in TB (vertical), so no layout click is needed
    const pos = entPositions(12)
    const ys = distinct(pos.map((p) => p.y))
    expect(ys).toHaveLength(2)
    expect(ys[1] - ys[0]).toBe(NODE_HEIGHT + WRAP_GAP)
    for (const y of ys) {
      expect(pos.filter((p) => p.y === y).length).toBeLessThanOrEqual(10)
    }
    expect(translate('Role A').y).toBeLessThan(translate('AP A').y)
    expect(translate('AP A').y).toBeLessThan(ys[0])
  })

  it('hide / show completed unwraps and re-wraps the lane, one fit per toggle', async () => {
    render(<AccessGraphCanvas graph={statusGraph(ents(12, 3))} />)
    drillIn()
    // layout now starts in TB; switch to horizontal so the lane wraps into columns (x)
    fireEvent.click(btn('Layout: horizontal'))
    // completed items start hidden by default; show them so all 12 entitlements
    // form the wrapped baseline this toggle test unwraps and re-wraps
    fireEvent.click(btn(/^Show completed items/))
    await waitFor(() => expect(plans()).toBeGreaterThan(0))
    const xsOf = (from: number, to: number) =>
      distinct(Array.from({ length: to - from }, (_, i) => translate(`Ent ${pad(from + i)}`).x))
    const wrapped = xsOf(0, 12)
    expect(wrapped).toHaveLength(2)

    let expected = plans()
    fireEvent.click(btn('Hide completed items'))
    expected += 1
    await waitFor(() => expect(plans()).toBe(expected))
    // 9 remain, one column.
    expect(xsOf(3, 12)).toHaveLength(1)
    expect(screen.queryByText('Ent 01')).toBeNull()

    fireEvent.click(btn(/^Show completed items/))
    expected += 1
    await waitFor(() => expect(plans()).toBe(expected))
    expect(xsOf(0, 12)).toEqual(wrapped)
  })

  it('hide / show reference: nested entitlements count towards the wrap', async () => {
    const nested = Array.from({ length: 6 }, (_, i) =>
      row({
        id: `n${i}`,
        role: 'Role A',
        roleId: 'ra',
        accessProfile: 'AP A',
        accessProfileId: 'apa',
        entitlement: `Nested ${pad(i)}`,
        entitlementId: `n${pad(i)}`,
        source: 'engr db',
        sourceId: 's1',
        ...(i === 0
          ? { reviewStatus: 'needsReview' as const, accessItemKind: 'role' as const, accessItemId: 'ra', accessItemName: 'Role A' }
          : {}),
      }),
    )
    render(<AccessGraphCanvas graph={statusGraph([...ents(6), ...nested])} />)
    drillIn()
    // layout now starts in TB; switch to horizontal so the lane wraps into columns (x)
    fireEvent.click(btn('Layout: horizontal'))
    // reference starts hidden by default; show it so the 6 nested entitlements
    // join the 6 first-level ones and form the wrapped (two-column) baseline
    fireEvent.click(btn('Show reference nodes and links'))
    await waitFor(() => expect(plans()).toBeGreaterThan(0))
    const entXs = () => {
      const labels = [
        ...Array.from({ length: 6 }, (_, i) => `Ent ${pad(i)}`),
        ...Array.from({ length: 6 }, (_, i) => `Nested ${pad(i)}`),
      ].filter((l) => screen.queryByText(l))
      return distinct(labels.map((l) => translate(l).x))
    }
    expect(entXs()).toHaveLength(2)

    let expected = plans()
    fireEvent.click(btn('Hide reference nodes and links'))
    expected += 1
    await waitFor(() => expect(plans()).toBe(expected))
    expect(entXs()).toHaveLength(1)

    fireEvent.click(btn('Show reference nodes and links'))
    expected += 1
    await waitFor(() => expect(plans()).toBe(expected))
    expect(entXs()).toHaveLength(2)
  })

  it('shows the visible first-level count in the hint, unaffected by wrapping', async () => {
    const { container } = render(<AccessGraphCanvas graph={statusGraph(ents(100))} />)
    drillIn()
    const root = container.querySelector<HTMLElement>('.react-flow')!
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 968, height: 490, right: 968, bottom: 490, x: 0, y: 0, toJSON() {} }) as DOMRect
    await waitFor(() => expect(plans()).toBeGreaterThan(0))
    expect(await screen.findByRole('status')).toHaveTextContent('100 items')
  })

  describe('interactions on a card in the last sub-column', () => {
    // 12 entitlements: 6 + 6. The card shown in the second column is found from
    // the rendered positions (dagre decides which entitlement lands where).
    let last = ''
    let lastId = ''

    function open() {
      render(<AccessGraphCanvas graph={statusGraph(ents(12))} />)
      drillIn()
      // layout now starts in TB; switch to horizontal so the lane wraps into columns (x)
      fireEvent.click(btn('Layout: horizontal'))
      // reference starts hidden by default; show it so each entitlement's source
      // lineage edge exists for the selection/hover assertions below
      fireEvent.click(btn('Show reference nodes and links'))
      const xs = entPositions(12).map((p) => p.x)
      const index = xs.indexOf(Math.max(...xs))
      last = `Ent ${pad(index)}`
      lastId = `e${pad(index)}`
    }

    it('selects, highlights its edge and lineage, and clears on click and Escape', () => {
      open()
      expect(translate(last).x).toBe(984 + NODE_WIDTH + WRAP_GAP)
      const target = card(last)
      fireEvent.click(target)
      expect(target).toHaveAttribute('aria-pressed', 'true')
      expect(withClass(SELECTED_EDGE_CLASS)).toHaveLength(0)
      expect(withClass(LINEAGE_EDGE_CLASS).map((e) => e.id)).toEqual([
        `e:entitlement:${lastId}:source:s1`,
      ])
      fireEvent.click(target)
      expect(target).toHaveAttribute('aria-pressed', 'false')
      expect(withClass(SELECTED_EDGE_CLASS)).toHaveLength(0)
      fireEvent.click(target)
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(target).toHaveAttribute('aria-pressed', 'false')
    })

    it('does not draw a user link when the card is hovered', () => {
      open()
      const target = card(last)
      const before = edges().map((e) => e.id)
      fireEvent.mouseEnter(target)
      expect(withClass('vc-graph-edge-emphasized')).toHaveLength(0)
      expect(edges().some((e) => e.source.startsWith('user:'))).toBe(false)
      expect(edges().map((e) => e.id)).toEqual(before)
      fireEvent.mouseLeave(target)
    })

    it('opens no hover tooltip (the detail panel carries that info)', () => {
      open()
      const target = card(last)
      fireEvent.mouseEnter(target)
      expect(screen.queryByRole('tooltip')).toBeNull()
    })
  })

  it('keeps the status on every wrapped card and lists every node kind in the legend', () => {
    render(<AccessGraphCanvas graph={statusGraph(ents(12, 2))} />)
    drillIn()
    // completed items and the legend start hidden by default; show both so the
    // two approved cards and the legend entries are present to assert on
    fireEvent.click(btn(/^Show completed items/))
    fireEvent.click(btn('Show legend'))
    for (let i = 0; i < 12; i++) {
      const c = card(`Ent ${pad(i)}`)
      expect(c.closest('.react-flow__node')).not.toBeNull()
      expect(within(c).getByRole('img', { hidden: true })).toHaveAttribute(
        'data-review-status',
        i < 2 ? 'approved' : 'needsReview',
      )
    }
    const legend = screen.getByRole('group', { name: /node legend/i })
    for (const text of [
      'Types',
      'User',
      'Role',
      'Access profile',
      'Entitlement',
      'Attribute',
      'Source',
      'Status',
      'Needs Review',
      'Approved',
      'Revoked',
      'Reassigned',
    ]) {
      expect(within(legend).getByText(text)).toBeInTheDocument()
    }
  })
})
