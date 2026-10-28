import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { statusGraph } from '../test/reviewStatusFixture'
import type { StatusRow } from '../test/reviewStatusFixture'
import { AccessGraphCanvas } from './AccessGraphCanvas'

// Separate file so mocking useReactFlow's fitView does not touch the other
// canvas tests. Everything else in @xyflow/react stays real.
const fitViewSpy = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
const setViewportSpy = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    useReactFlow: () => ({
      ...actual.useReactFlow(),
      fitView: fitViewSpy,
      setViewport: setViewportSpy,
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

const PX = /^\d+px$/
const btn = (name: string | RegExp) => screen.getByRole('button', { name })
const lastPadding = () => {
  const calls = fitViewSpy.mock.calls as unknown as [{ padding: Record<string, string> }?][]
  return calls.at(-1)?.[0]?.padding
}
const drillIn = () => fireEvent.click(btn('Show access for User One'))
const rect = (l: number, t: number, w: number, h: number) =>
  ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} }) as DOMRect

describe('AccessGraphCanvas overlay-aware fit', () => {
  beforeEach(() => fitViewSpy.mockClear())

  it('fits with per-side px padding when drilling in', async () => {
    render(<AccessGraphCanvas graph={graph()} />)
    await waitFor(() => expect(fitViewSpy).toHaveBeenCalled())
    fitViewSpy.mockClear()
    drillIn()
    await waitFor(() => expect(fitViewSpy).toHaveBeenCalledTimes(1))
    const padding = lastPadding()!
    for (const side of ['top', 'right', 'bottom', 'left']) expect(padding[side]).toMatch(PX)
  })

  it('refits on minimap, reference and layout toggles and on Back', async () => {
    render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    await waitFor(() => expect(fitViewSpy).toHaveBeenCalled())
    let expected = fitViewSpy.mock.calls.length
    const expectOneMore = async () => {
      expected += 1
      await waitFor(() => expect(fitViewSpy).toHaveBeenCalledTimes(expected))
    }
    // Every control starts off, so each toggle fires a refit on the way on
    // (and the completed toggle once more on the way back off).
    fireEvent.click(btn('Show minimap'))
    await expectOneMore()
    fireEvent.click(btn('Show reference nodes and links'))
    await expectOneMore()
    // layout now starts in TB; the button reads "Layout: horizontal" after drill-in
    fireEvent.click(btn('Layout: horizontal'))
    await expectOneMore()
    fireEvent.click(btn(/^Show completed items/))
    await expectOneMore()
    fireEvent.click(btn('Hide completed items'))
    await expectOneMore()
    fireEvent.click(screen.getByRole('button', { name: '← All Users' }))
    await expectOneMore()
  })

  it('omits the Completed button in the grid, so the grid fit stays put', async () => {
    render(<AccessGraphCanvas graph={graph()} />)
    await waitFor(() => expect(fitViewSpy).toHaveBeenCalled())
    const calls = fitViewSpy.mock.calls.length
    expect(screen.queryByRole('button', { name: /completed items/i })).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fitViewSpy).toHaveBeenCalledTimes(calls)
  })

  it('pads the fit by the measured overlay sizes', async () => {
    const { container } = render(<AccessGraphCanvas graph={graph()} />)
    drillIn()
    await waitFor(() => expect(fitViewSpy).toHaveBeenCalled())
    // The legend overlay starts off; show it so the bottom-left panel has a size.
    fireEvent.click(btn('Show legend'))
    // Scoped, per-instance rects (never Element.prototype).
    const root = container.querySelector<HTMLElement>('.react-flow')!
    root.getBoundingClientRect = () => rect(0, 0, 968, 490)
    const legend = container.querySelector<HTMLElement>('.vc-graph-legend-panel')!
    legend.getBoundingClientRect = () => rect(15, 200, 236, 186) // right 251, bottom 386
    fireEvent.click(btn('Show minimap')) // triggers a refit
    await waitFor(() => expect(parseInt(lastPadding()!.left, 10)).toBeGreaterThanOrEqual(251 + 12))
  })

  describe('access types keep their own lane, with reference shown or hidden', () => {
    /** One first-level item of each type, plus a second entitlement, with lineage. */
    function threeKinds() {
      return statusGraph([
        row({ id: '1', role: 'Role A', roleId: 'role-a', accessProfile: 'foo', accessProfileId: 'ap-foo', entitlement: 'read', entitlementId: 'e1', source: 'engr db', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-a', accessItemName: 'Role A' }),
        row({ id: '2', accessProfile: 'Billing', accessProfileId: 'ap-bill', entitlement: 'invoice', entitlementId: 'e4', source: 'erp', sourceId: 's3', reviewStatus: 'approved', accessItemKind: 'accessProfile', accessItemId: 'ap-bill', accessItemName: 'Billing' }),
        row({ id: '3', entitlement: 'login', entitlementId: 'e2', source: 'phone app', sourceId: 's2', reviewStatus: 'approved', accessItemKind: 'entitlement', accessItemId: 'e2', accessItemName: 'login' }),
        row({ id: '4', entitlement: 'admin', entitlementId: 'e3', source: 'phone app', sourceId: 's2', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e3', accessItemName: 'admin' }),
      ])
    }
    const translate = (label: string) => {
      const wrapper = screen.getByText(label).closest<HTMLElement>('.react-flow__node')!
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(wrapper.style.transform)!
      return { x: Number(m[1]), y: Number(m[2]) }
    }
    const items = ['Role A', 'Billing', 'login', 'admin']

    it('hidden, horizontal: role, access profile, entitlement each get their own column, in that order', () => {
      const { container } = render(<AccessGraphCanvas graph={threeKinds()} />)
      drillIn()
      // layout now starts in TB; switch to horizontal for this test
      fireEvent.click(btn('Layout: horizontal'))
      // Reference nodes/links are hidden by default; show completed so all four
      // first-level items (three of them completed) render.
      fireEvent.click(btn(/^Show completed items/))

      // The four first-level items stay in the graph. The user card is pinned.
      expect(container.querySelectorAll('.react-flow__node')).toHaveLength(4)
      expect(container.querySelector('.vc-graph-user-pin')).toHaveTextContent('User One')
      const [role, ap, login, admin] = items.map(translate)

      // Left to right: role, then access profile, then entitlements.
      expect(role.x).toBeLessThan(ap.x)
      expect(ap.x).toBeLessThan(login.x)
      // Both entitlements share the entitlement column, stacked apart.
      expect(login.x).toBe(admin.x)
      expect(login.y).not.toBe(admin.y)
    })

    it('hidden, vertical: the same three types get their own rows, top to bottom', () => {
      render(<AccessGraphCanvas graph={threeKinds()} />)
      drillIn()
      // Reference hidden by default; show completed so all four items render.
      fireEvent.click(btn(/^Show completed items/))
      // layout now starts in TB (vertical), so no layout click is needed

      const [role, ap, login, admin] = items.map(translate)
      expect(role.y).toBeLessThan(ap.y)
      expect(ap.y).toBeLessThan(login.y)
      expect(login.y).toBe(admin.y)
      expect(login.x).not.toBe(admin.x)
    })

    it('hiding reference does not move an access type to a different lane', () => {
      render(<AccessGraphCanvas graph={threeKinds()} />)
      drillIn()
      // layout now starts in TB; switch to horizontal for this test (lane = x)
      fireEvent.click(btn('Layout: horizontal'))
      // Show completed so all four items render, then compare reference shown
      // vs hidden. Reference starts hidden; show it for the baseline first.
      fireEvent.click(btn(/^Show completed items/))
      fireEvent.click(btn('Show reference nodes and links'))
      const shown = items.map(translate)
      fireEvent.click(btn('Hide reference nodes and links'))
      const hidden = items.map(translate)
      // The lane (rank-axis coordinate, x in the horizontal layout) of every
      // first-level item is identical shown vs hidden.
      expect(hidden.map((p) => p.x)).toEqual(shown.map((p) => p.x))
    })

    describe('hiding completed items re-lays out without gaps', () => {
      /** Needs-review role / access profile / entitlement x2; one completed of each plus extras. */
      function mixedKinds() {
        const r = (o: Partial<StatusRow>) => row(o)
        return statusGraph([
          r({ id: '1', role: 'Role A', roleId: 'role-a', entitlement: 'read', entitlementId: 'e1', source: 'db', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'role', accessItemId: 'role-a' }),
          r({ id: '2', role: 'Role B', roleId: 'role-b', entitlement: 'read', entitlementId: 'e1', source: 'db', sourceId: 's1', reviewStatus: 'approved', accessItemKind: 'role', accessItemId: 'role-b' }),
          r({ id: '3', accessProfile: 'AP One', accessProfileId: 'ap-1', entitlement: 'w', entitlementId: 'e5', source: 'db', sourceId: 's1', reviewStatus: 'revoked', accessItemKind: 'accessProfile', accessItemId: 'ap-1' }),
          r({ id: '4', entitlement: 'e-one', entitlementId: 'e2', source: 'db', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: 'e2' }),
          r({ id: '5', entitlement: 'e-two', entitlementId: 'e3', source: 'db', sourceId: 's1', reviewStatus: 'reassigned', accessItemKind: 'entitlement', accessItemId: 'e3' }),
          r({ id: '6', entitlement: 'e-three', entitlementId: 'e4', source: 'db', sourceId: 's1', reviewStatus: 'needsReview', accessItemKind: 'entitlement', accessItemId: 'e4' }),
        ])
      }

      it('keeps the lanes in order and packs the remaining cards evenly (horizontal)', () => {
        render(<AccessGraphCanvas graph={mixedKinds()} />)
        drillIn()
        // layout now starts in TB; switch to horizontal for this test
        fireEvent.click(btn('Layout: horizontal'))
        // Completed items start hidden; show them for the baseline measurement.
        fireEvent.click(btn(/^Show completed items/))
        // The lane stride is the gap between two adjacent cards; take it from the
        // two lowest shown entitlement positions (adjacency is independent of
        // which names those are, since cards sort A→Z by name).
        const shownYs = ['e-one', 'e-two', 'e-three']
          .map((n) => translate(n).y)
          .sort((a, b) => a - b)
        const stride = shownYs[1] - shownYs[0]
        fireEvent.click(btn('Hide completed items'))
        expect(screen.queryByText('AP One')).toBeNull()
        expect(screen.queryByText('Role B')).toBeNull()
        expect(screen.queryByText('e-two')).toBeNull()
        const role = translate('Role A')
        const ent1 = translate('e-one')
        const ent3 = translate('e-three')
        expect(role.x).toBeLessThan(ent1.x)
        expect(ent1.x).toBe(ent3.x)
        // The two remaining entitlements are adjacent (one stride apart), not
        // separated by the hidden one's slot.
        expect(Math.abs(ent3.y - ent1.y)).toBe(stride)
      })

      it('keeps the lanes in order and packs the remaining cards evenly (vertical)', () => {
        render(<AccessGraphCanvas graph={mixedKinds()} />)
        drillIn()
        // Completed items start hidden; show them for the baseline measurement.
        fireEvent.click(btn(/^Show completed items/))
        // layout now starts in TB (vertical), so no layout click is needed
        const shownXs = ['e-one', 'e-two', 'e-three']
          .map((n) => translate(n).x)
          .sort((a, b) => a - b)
        const stride = shownXs[1] - shownXs[0]
        fireEvent.click(btn('Hide completed items'))
        const role = translate('Role A')
        const ent1 = translate('e-one')
        const ent3 = translate('e-three')
        expect(role.y).toBeLessThan(ent1.y)
        expect(ent1.y).toBe(ent3.y)
        expect(Math.abs(ent3.x - ent1.x)).toBe(stride)
      })
    })

    it('a type the user does not hold simply has no cards (the others keep their lanes)', () => {
      // Entitlements only: no role or access profile cards at all.
      render(
        <AccessGraphCanvas
          graph={statusGraph([
            row({ id: '3', entitlement: 'login', entitlementId: 'e2', source: 'phone app', sourceId: 's2', reviewStatus: 'approved', accessItemKind: 'entitlement', accessItemId: 'e2', accessItemName: 'login' }),
            row({ id: '4', entitlement: 'admin', entitlementId: 'e3', source: 'phone app', sourceId: 's2', reviewStatus: 'revoked', accessItemKind: 'entitlement', accessItemId: 'e3', accessItemName: 'admin' }),
          ])}
        />,
      )
      drillIn()
      // layout now starts in TB; switch to horizontal for this test (lane = x)
      fireEvent.click(btn('Layout: horizontal'))
      // Reference nodes/links are hidden by default; both items are completed,
      // which is also hidden by default, so show completed to render the cards.
      fireEvent.click(btn(/^Show completed items/))
      const login = translate('login')
      const admin = translate('admin')
      expect(login.x).toBe(admin.x)
    })
  })
})
