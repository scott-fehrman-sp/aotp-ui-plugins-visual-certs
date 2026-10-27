import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveAccessGraph } from '../domain/accessGraph'
import { statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { AccessGraphCanvas } from './AccessGraphCanvas'
import { READABLE_MIN_ZOOM } from './fitPadding'

// Separate file: wraps ReactFlow to expose its store (jsdom has no layout, so the
// canvas size is written to the store directly) and spies on fitView /
// setViewport to see which refit path ran. Everything else stays real.
const spies = vi.hoisted(() => ({
  fitView: vi.fn(() => Promise.resolve(true)),
  setViewport: vi.fn(() => Promise.resolve(true)),
  store: null as null | { setState: (s: { width: number; height: number }) => void },
}))
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  function Probe() {
    spies.store = actual.useStoreApi()
    return null
  }
  const Wrapped = (props: React.ComponentProps<typeof actual.ReactFlow>) => (
    <actual.ReactFlow {...props}>
      <Probe />
      {props.children}
    </actual.ReactFlow>
  )
  return {
    ...actual,
    ReactFlow: Wrapped,
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

/** Three directly held entitlements: fits the canvas at a normal zoom. */
function shortGraph() {
  return statusGraph(
    [1, 2, 3].map((n) =>
      row({ id: String(n), entitlement: `e${n}`, entitlementId: `e${n}`, source: 's', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: `e${n}`, accessItemName: `e${n}` }),
    ),
  )
}

/**
 * 100 directly held entitlements: a long list. The lane wraps into ten
 * sub-columns (LR) / sub-rows (TB), still too wide to fit at a readable zoom.
 */
function longGraph(count = 200) {
  return statusGraph(
    Array.from({ length: count }, (_, i) => {
      const n = i + 1
      return row({ id: String(n), entitlement: `Ent ${n}`, entitlementId: `e${n}`, source: 's', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: `e${n}`, accessItemName: `Ent ${n}` })
    }),
  )
}

/** `total` directly held entitlements, the first `completed` of them approved. */
function longWithCompleted(completed: number, total = 200) {
  return statusGraph(
    Array.from({ length: total }, (_, i) => {
      const n = i + 1
      return row({ id: String(n), entitlement: `Ent ${n}`, entitlementId: `e${n}`, source: 's', sourceId: 's1', reviewStatus: n <= completed ? 'approved' : 'needsReview', accessItemKind: 'entitlement', accessItemId: `e${n}`, accessItemName: `Ent ${n}` })
    }),
  )
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name })
const drillIn = (name = 'User One') => fireEvent.click(btn(`Show access for ${name}`))
const rect = (l: number, t: number, w: number, h: number) =>
  ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} }) as DOMRect

/** Gives the canvas a size (scoped, per instance) and makes it refit. */
async function sizeCanvas(container: HTMLElement, width: number, height: number) {
  const root = container.querySelector<HTMLElement>('.react-flow')!
  root.getBoundingClientRect = () => rect(0, 0, width, height)
  spies.fitView.mockClear()
  spies.setViewport.mockClear()
  act(() => spies.store!.setState({ width, height }))
  await waitFor(() => expect(spies.fitView.mock.calls.length + spies.setViewport.mock.calls.length).toBe(1))
}

function lastZoom() {
  const calls = spies.setViewport.mock.calls as unknown as [{ zoom: number }][]
  return calls.at(-1)![0].zoom
}

describe('AccessGraphCanvas readable zoom for long graphs', () => {
  beforeEach(() => {
    spies.fitView.mockClear()
    spies.setViewport.mockClear()
  })

  it('fits a short graph with fitView, never setViewport, and shows no hint', async () => {
    const { container } = render(<AccessGraphCanvas graph={shortGraph()} />)
    drillIn()
    await sizeCanvas(container, 968, 490)
    expect(spies.fitView).toHaveBeenCalledTimes(1)
    expect(spies.setViewport).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('opens a long graph at the readable zoom (LR) and shows the count hint', async () => {
    const { container } = render(<AccessGraphCanvas graph={longGraph()} />)
    drillIn()
    // layout now starts in TB; switch to horizontal for this LR test
    fireEvent.click(btn('Layout: horizontal'))
    await sizeCanvas(container, 968, 490)
    expect(spies.setViewport).toHaveBeenCalledTimes(1)
    expect(spies.fitView).not.toHaveBeenCalled()
    expect(lastZoom()).toBe(READABLE_MIN_ZOOM)
    const hint = screen.getByRole('status')
    expect(hint).toHaveTextContent('200 items — scroll or drag to see all')
    expect(hint.closest('.react-flow__panel')).toHaveClass('top', 'center', 'vc-graph-fit-ignore')
  })

  it('fits 30 entitlements with fitView now that the lane wraps (no hint)', async () => {
    // Intended effect of lane wrapping: 30 entitlements used to be a ~3,300 px
    // column (readable zoom + hint); as three 10-card columns they fit.
    const { container } = render(<AccessGraphCanvas graph={longGraph(30)} />)
    drillIn()
    await sizeCanvas(container, 968, 490)
    expect(spies.fitView).toHaveBeenCalledTimes(1)
    expect(spies.setViewport).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('opens a long graph at the readable zoom in TB too', async () => {
    const { container } = render(<AccessGraphCanvas graph={longGraph()} />)
    drillIn()
    // layout now starts in TB, so no layout click is needed to reach it
    await sizeCanvas(container, 968, 490)
    expect(lastZoom()).toBe(READABLE_MIN_ZOOM)
    expect(screen.getByRole('status')).toHaveTextContent('200 items')
  })

  it('each refit trigger produces exactly one plan', async () => {
    const { container } = render(<AccessGraphCanvas graph={longGraph()} />)
    drillIn()
    await sizeCanvas(container, 968, 490)
    const plans = () => spies.fitView.mock.calls.length + spies.setViewport.mock.calls.length
    let expected = plans()
    for (const name of [
      'Show minimap',
      'Show reference nodes and links',
      /^Show completed items/,
      // layout now starts in TB; the button reads "Layout: horizontal" after drill-in
      'Layout: horizontal',
    ]) {
      fireEvent.click(btn(name))
      expected += 1
      await waitFor(() => expect(plans()).toBe(expected))
    }
    // Resizing the canvas refits once.
    act(() => spies.store!.setState({ width: 800, height: 400 }))
    expected += 1
    await waitFor(() => expect(plans()).toBe(expected))
  })

  describe('hiding completed items', () => {
    const plans = () => spies.fitView.mock.calls.length + spies.setViewport.mock.calls.length

    it('counts and fits the visible items: a still-long list keeps the readable zoom and hint', async () => {
      const { container } = render(<AccessGraphCanvas graph={longWithCompleted(10)} />)
      drillIn()
      // layout now starts in TB; switch to horizontal so the long-list readable
      // zoom + hint behavior this test asserts (unchanged by the TB default) holds
      fireEvent.click(btn('Layout: horizontal'))
      await sizeCanvas(container, 968, 490)
      // Completed items start hidden; show them to reach the full-list baseline.
      fireEvent.click(btn(/^Show completed items/))
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('200 items — scroll or drag to see all'),
      )
      spies.setViewport.mockClear()

      const before = plans()
      fireEvent.click(btn('Hide completed items'))
      await waitFor(() => expect(plans()).toBe(before + 1))
      expect(spies.setViewport).toHaveBeenCalledTimes(1)
      expect(lastZoom()).toBe(READABLE_MIN_ZOOM)
      expect(screen.getByRole('status')).toHaveTextContent('190 items — scroll or drag to see all')

      const afterHide = plans()
      fireEvent.click(btn(/^Show completed items/))
      await waitFor(() => expect(plans()).toBe(afterHide + 1))
      expect(screen.getByRole('status')).toHaveTextContent('200 items')
    })

    it('drops back to a normal fit with no hint when few items remain', async () => {
      const { container } = render(<AccessGraphCanvas graph={longWithCompleted(194)} />)
      drillIn()
      await sizeCanvas(container, 968, 490)
      // Completed items start hidden; show them to reach the full-list baseline.
      fireEvent.click(btn(/^Show completed items/))
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('200 items'))
      spies.fitView.mockClear()
      spies.setViewport.mockClear()

      fireEvent.click(btn('Hide completed items'))
      await waitFor(() => expect(plans()).toBe(1))
      expect(spies.fitView).toHaveBeenCalledTimes(1)
      expect(spies.setViewport).not.toHaveBeenCalled()
      expect(screen.queryByRole('status')).toBeNull()
    })
  })

  it('shows no hint in the user grid, and no hint once back from the drill-down', async () => {
    const { container } = render(<AccessGraphCanvas graph={longGraph()} />)
    expect(screen.queryByRole('status')).toBeNull()
    drillIn()
    await sizeCanvas(container, 968, 490)
    expect(screen.getByRole('status')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /back to all users/i }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows no hint for a degenerate user (only the note)', async () => {
    const graph = deriveAccessGraph([
      row({ id: '1', userId: 'u1', user: 'User One' }),
      row({ id: '2', userId: 'u2', user: 'User Two', entitlement: 'x', entitlementId: 'e9', source: 's', sourceId: 's9' }),
    ])
    const { container } = render(<AccessGraphCanvas graph={graph} />)
    drillIn('User One')
    await sizeCanvas(container, 968, 490)
    expect(screen.getByText('No expanded access for this user.')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('is ignored by the overlay measurement (it would otherwise cost a huge top strip)', async () => {
    const { container } = render(<AccessGraphCanvas graph={longGraph()} />)
    drillIn()
    await sizeCanvas(container, 968, 490)
    const panel = screen.getByRole('status').closest<HTMLElement>('.react-flow__panel')!
    panel.getBoundingClientRect = () => rect(300, 24, 360, 400)
    const { measureOverlays } = await import('./fitPadding')
    const root = container.querySelector<HTMLElement>('.react-flow')!
    const measured = measureOverlays(root).overlays
    expect(measured.some((b) => b.left === 300 && b.bottom === 424)).toBe(false)
  })
})
