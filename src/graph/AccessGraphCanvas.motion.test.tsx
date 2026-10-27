import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Edge, Node } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import type { AccessGraphData } from '../sailpoint/types'
import { AccessGraphCanvas } from './AccessGraphCanvas'
import { LINEAGE_EDGE_CLASS } from './selectEdges'

// Transition behavior of the canvas under jsdom: it cannot paint, so this checks
// the DOM classes / attributes React Flow is handed over time (with fake timers
// and the `motionMs` seam), not the pixels. The glide and the fades themselves
// are checked in a real browser.
const spies = vi.hoisted(() => ({
  fitView: vi.fn<(options?: unknown) => Promise<boolean>>(() => Promise.resolve(true)),
  setViewport: vi.fn<(viewport: unknown, options?: unknown) => Promise<boolean>>(() => Promise.resolve(true)),
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

const MOTION = 450

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
/** User One: role-a{ap-foo{e1}} needsReview; login approved, admin revoked. User Two: pay. */
function graph(): AccessGraphData {
  return statusGraph([
    row({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-a', accessItemName: 'Role A' }),
    row({ id: '2', entitlement: 'login', entitlementId: 'e2', source: 'phone app', sourceId: 's2', reviewStatus: 'approved', accessItemKind: 'entitlement', accessItemId: 'e2', accessItemName: 'login' }),
    row({ id: '3', entitlement: 'admin', entitlementId: 'e3', source: 'phone app', sourceId: 's2', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e3', accessItemName: 'admin' }),
    row({ id: '4', userId: 'u2', user: 'User Two', entitlement: 'pay', entitlementId: 'e4', source: 'erp', sourceId: 's3', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: 'e4', accessItemName: 'pay' }),
  ])
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name })
const drillIn = () => fireEvent.click(btn('Show access for User One'))
// One animation frame per act(): React must render between the frames, as it does
// in a browser, or a chain of frame callbacks would run before the first commit.
const advance = (ms: number) => {
  for (let left = ms; left > 0; left -= 16) act(() => void vi.advanceTimersByTime(Math.min(16, left)))
}
const edges = () => spies.edges as Edge[]
const nodes = () => spies.nodes as Node[]
const wrappers = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('.react-flow__node')]
const wrapper = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
const idsOf = (container: HTMLElement) => wrappers(container).map((el) => el.dataset.id!)
const hasClass = (el: Element | null, name: string) => el?.classList.contains(name) ?? false
const transitioning = (container: HTMLElement) =>
  wrappers(container).filter((el) => /\b(entering|exiting)\b/.test(el.className))
const fitDurations = () =>
  spies.fitView.mock.calls.map((call) => (call[0] as { duration?: number } | undefined)?.duration)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  spies.fitView.mockClear()
  spies.setViewport.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

/** Mounts the canvas and lets the first fit and the first display settle. */
function mount(motionMs = MOTION, g = graph()) {
  const view = render(<AccessGraphCanvas graph={g} motionMs={motionMs} />)
  advance(MOTION * 4)
  return view
}
/** Drills into User One and lets the transition finish. */
function drill(view: ReturnType<typeof mount>) {
  drillIn()
  advance(MOTION + 100)
  return view
}

describe('drill-down transition', () => {
  it('pins the clicked user and fades both grid cards out', () => {
    const { container } = mount()
    const clicked = wrapper(container, 'user:u1')!
    const other = wrapper(container, 'user:u2')!
    drillIn()
    // The identity moves to the pinned card immediately. Both grid cards,
    // including the one that was clicked, leave the flow.
    expect(document.querySelector('.vc-graph-user-pin')).toHaveTextContent('User One')
    expect(wrapper(container, 'user:u1')).toBe(clicked)
    expect(wrapper(container, 'user:u2')).toBe(other)
    expect(hasClass(clicked, 'exiting')).toBe(true)
    expect(hasClass(other, 'exiting')).toBe(true)
    expect(other.hasAttribute('inert')).toBe(true)
    expect(other.getAttribute('aria-hidden')).toBe('true')
    advance(MOTION - 1)
    expect(wrapper(container, 'user:u2')).not.toBeNull()
    advance(1)
    expect(wrapper(container, 'user:u2')).toBeNull()
    expect(wrapper(container, 'user:u1')).toBeNull()
    expect(document.querySelector('.vc-graph-user-pin')).toHaveTextContent('User One')
  })

  it('lineage cards appear entering, lose the class after two frames, and end clean', () => {
    const { container } = mount()
    drillIn()
    const lineage = wrappers(container).filter((el) => el.dataset.id !== 'user:u1' && el.dataset.id !== 'user:u2')
    expect(lineage.length).toBeGreaterThan(0)
    expect(lineage.every((el) => hasClass(el, 'entering'))).toBe(true)
    advance(32)
    expect(lineage.every((el) => !hasClass(el, 'entering'))).toBe(true)
    advance(MOTION)
    expect(transitioning(container)).toEqual([])
    expect(idsOf(container).sort()).toEqual(
      idsOf(container).filter((id, i, all) => all.indexOf(id) === i).sort(),
    )
  })

  it('moves keyboard focus to the pinned user card', () => {
    const { container } = mount()
    const clicked = wrapper(container, 'user:u1')!
    const cardEl = clicked.querySelector<HTMLElement>('article')!
    cardEl.focus()
    expect(document.activeElement).toBe(cardEl)
    fireEvent.keyDown(cardEl, { key: 'Enter' })
    advance(MOTION + 100)
    expect(wrapper(container, 'user:u1')).toBeNull()
    const pinned = document.querySelector<HTMLElement>('.vc-graph-user-pin article')!
    expect(document.activeElement).toBe(pinned)
  })

  it('Back to all users mirrors it: the lineage fades out, the users cascade in', () => {
    const { container } = drill(mount())
    expect(document.querySelector('.vc-graph-user-pin')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /back to all users/i }))
    expect(document.querySelector('.vc-graph-user-pin')).toBeNull()
    const lineage = wrappers(container).filter((el) => /^(role|accessProfile|entitlement|source):/.test(el.dataset.id!))
    expect(lineage.length).toBeGreaterThan(0)
    expect(lineage.every((el) => hasClass(el, 'exiting') && el.hasAttribute('inert'))).toBe(true)
    // The pinned user was not a flow node, so both grid cards arrive together.
    for (const id of ['user:u1', 'user:u2']) {
      const card = wrapper(container, id)!
      expect(hasClass(card, 'reveal')).toBe(true)
      expect(card.style.getPropertyValue('--reveal-delay')).toMatch(/^\d+ms$/)
    }
    advance(MOTION)
    expect(idsOf(container).sort()).toEqual(['user:u1', 'user:u2'])
  })

  it('shows the grid with a cascade on the first display', () => {
    const { container } = render(<AccessGraphCanvas graph={graph()} motionMs={MOTION} />)
    expect(wrappers(container).every((el) => hasClass(el, 'reveal'))).toBe(true)
    const delays = wrappers(container).map((el) => el.style.getPropertyValue('--reveal-delay'))
    expect(new Set(delays).size).toBe(delays.length)
  })
})

describe('toggles', () => {
  it('hide completed keeps the staying cards, fades the hidden ones, and show completed brings them back entering', () => {
    const { container } = drill(mount())
    // completed items start hidden by default; show them so the completed cards
    // exist to fade out when hidden again
    fireEvent.click(btn(/^Show completed items/))
    advance(MOTION + 100)
    const staying = [wrapper(container, 'role:role-a')!]
    const completedIds = idsOf(container).filter((id) => /e2|e3/.test(id))
    expect(completedIds.length).toBeGreaterThan(0)
    fireEvent.click(btn('Hide completed items'))
    expect(staying.map((el) => wrapper(container, el.dataset.id!))).toEqual(staying)
    for (const id of completedIds) expect(hasClass(wrapper(container, id), 'exiting')).toBe(true)
    advance(MOTION)
    for (const id of completedIds) expect(wrapper(container, id)).toBeNull()
    expect(transitioning(container)).toEqual([])

    fireEvent.click(btn(/^Show completed items/))
    for (const id of completedIds) expect(hasClass(wrapper(container, id), 'entering')).toBe(true)
    advance(MOTION + 100)
    for (const id of completedIds) expect(wrapper(container, id)).not.toBeNull()
    expect(transitioning(container)).toEqual([])
  })

  it('five rapid reference toggles end in the right state without leftovers', () => {
    const { container } = drill(mount())
    // reference starts hidden by default; show it first so the five toggles end
    // in the hidden (no source nodes) state this test asserts
    fireEvent.click(screen.getByRole('button', { name: 'Show reference nodes and links' }))
    advance(MOTION + 100)
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: /reference nodes and links/ }))
      advance(40)
    }
    advance(MOTION + 200)
    const ids = idsOf(container)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.some((id) => id.startsWith('source:'))).toBe(false)
    expect(transitioning(container)).toEqual([])
    const lastFit = spies.fitView.mock.calls.at(-1)![0] as { nodes: { id: string }[]; duration: number }
    expect(lastFit.duration).toBe(MOTION)
    expect(lastFit.nodes.map((n) => n.id).sort()).toEqual([...ids].sort())
  })

  it('a Back pressed while drilling in ends in a clean grid', () => {
    const { container } = mount()
    drillIn()
    advance(120)
    fireEvent.click(screen.getByRole('button', { name: /back to all users/i }))
    advance(MOTION * 4)
    expect(idsOf(container).sort()).toEqual(['user:u1', 'user:u2'])
    expect(transitioning(container)).toEqual([])
  })
})

describe('hover and selection', () => {
  it('never start a transition or touch the nodes handed to React Flow', () => {
    const { container } = drill(mount())
    fireEvent.click(btn('Show reference nodes and links'))
    advance(MOTION + 100)
    const before = idsOf(container)
    const classes = wrappers(container).map((el) => el.className)
    const nodesBefore = nodes()
    spies.fitView.mockClear()
    const roleCard = screen.getByText('Role A').closest<HTMLElement>('.vc-graph-card')!
    fireEvent.mouseEnter(roleCard)
    fireEvent.click(roleCard)
    advance(MOTION * 2)
    expect(idsOf(container)).toEqual(before)
    expect(wrappers(container).map((el) => el.className)).toEqual(classes)
    expect(nodes()).toBe(nodesBefore)
    expect(spies.fitView).not.toHaveBeenCalled()
    expect(edges().some((e) => e.source === 'user:u1')).toBe(false)
    expect(edges().some((e) => e.className?.includes(LINEAGE_EDGE_CLASS))).toBe(true)
  })

  it('selecting mid-transition leaves leaving edges untouched and appends to the others', () => {
    const { container } = drill(mount())
    // completed items start hidden by default; show them so hiding them again
    // produces the leaving edges this test checks mid-transition
    fireEvent.click(btn('Show reference nodes and links'))
    fireEvent.click(btn(/^Show completed items/))
    advance(MOTION + 100)
    fireEvent.click(btn('Hide completed items'))
    const leaving = edges().filter((e) => e.className?.split(' ').includes('exiting'))
    expect(leaving.length).toBeGreaterThan(0)
    const roleCard = screen.getByText('Role A').closest<HTMLElement>('.vc-graph-card')!
    fireEvent.click(roleCard)
    for (const edge of leaving) {
      const now = edges().find((e) => e.id === edge.id)!
      expect(now).toBe(edge)
      expect(now.style?.opacity).toBe(edge.style?.opacity)
    }
    const selected = edges().find((e) => e.className?.includes(LINEAGE_EDGE_CLASS))!
    expect(selected.className).not.toContain('vc-graph-edge-needsReview')
    expect(transitioning(container).length).toBeGreaterThan(0)
    advance(MOTION + 100)
    expect(transitioning(container)).toEqual([])
    expect(edges().find((e) => e.id === selected.id)!.className).toContain(LINEAGE_EDGE_CLASS)
  })
})

describe('camera', () => {
  it('the first fit is instant and later fits use the motion duration', () => {
    mount()
    expect(fitDurations()[0]).toBe(0)
    expect(fitDurations().slice(1).every((d) => d === MOTION)).toBe(true)
  })

  it('fits once per trigger, only after the cards are placed, from target ids only', () => {
    const { container } = mount()
    spies.fitView.mockClear()
    drillIn()
    advance(20)
    expect(spies.fitView).not.toHaveBeenCalled()
    advance(100)
    expect(spies.fitView).toHaveBeenCalledTimes(1)
    const args = spies.fitView.mock.calls[0][0] as { nodes: { id: string }[]; duration: number }
    expect(args.duration).toBe(MOTION)
    expect(args.nodes.map((n) => n.id)).not.toContain('user:u2')
    advance(MOTION * 2)
    expect(spies.fitView).toHaveBeenCalledTimes(1)
    expect(args.nodes.map((n) => n.id).sort()).toEqual(idsOf(container).sort())
  })

  it('fits once for a toggle with only staying cards', () => {
    drill(mount())
    spies.fitView.mockClear()
    // layout now starts in TB; the button reads "Layout: horizontal" after drill-in
    fireEvent.click(btn('Layout: horizontal'))
    advance(MOTION * 2)
    expect(spies.fitView.mock.calls.length + spies.setViewport.mock.calls.length).toBe(1)
  })
})

describe('no motion', () => {
  it.each([[0], [undefined]])('with motionMs=%s every update is instant', (ms) => {
    const { container } = render(<AccessGraphCanvas graph={graph()} motionMs={ms as number | undefined} />)
    const seen: string[] = []
    const record = () => seen.push(...wrappers(container).map((el) => el.className))
    record()
    drillIn()
    record()
    // completed items start hidden by default; show then hide them so the hide
    // path is still exercised, and confirm every change is instant
    fireEvent.click(btn(/^Show completed items/))
    record()
    fireEvent.click(btn('Hide completed items'))
    record()
    fireEvent.click(screen.getByRole('button', { name: /back to all users/i }))
    record()
    expect(seen.some((c) => /\b(entering|exiting|reveal)\b/.test(c))).toBe(false)
    expect(idsOf(container).sort()).toEqual(['user:u1', 'user:u2'])
    expect(container.querySelector('.react-flow.motion-on')).toBeNull()
  })
})

describe('size guard', () => {
  it('skips the animation for a graph too big to animate', () => {
    const rows: StatusRow[] = [
      row({ id: 'o', userId: 'u2', user: 'User Two', entitlement: 'pay', entitlementId: 'p', source: 'erp', sourceId: 's', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: 'p', accessItemName: 'pay' }),
    ]
    for (let i = 0; i < 401; i += 1) {
      rows.push(row({ id: `b${i}`, entitlement: `ent${i}`, entitlementId: `x${i}`, source: 'src', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: `x${i}`, accessItemName: `ent${i}` }))
    }
    const { container } = mount(MOTION, statusGraph(rows))
    drillIn()
    expect(wrapper(container, 'user:u2')).toBeNull()
    expect(transitioning(container)).toEqual([])
  })
})
