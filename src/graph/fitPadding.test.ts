import { describe, expect, it } from 'vitest'
import {
  READABLE_MIN_ZOOM,
  SCROLL_MODE_FIT_ZOOM,
  computeFitPadding,
  isGraphOutOfView,
  measureOverlays,
  planFit,
  readableViewport,
  toFitViewPadding,
  type Box,
  type FitPadding,
} from './fitPadding'

const CANVAS = { width: 968, height: 490 }
const box = (left: number, top: number, right: number, bottom: number): Box => ({
  left,
  top,
  right,
  bottom,
})

describe('computeFitPadding', () => {
  it('gives the base margin on every side when there are no overlays', () => {
    expect(computeFitPadding(CANVAS, [])).toEqual({ top: 24, right: 24, bottom: 24, left: 24 })
    expect(computeFitPadding(CANVAS, [], { base: 10 })).toEqual({
      top: 10,
      right: 10,
      bottom: 10,
      left: 10,
    })
  })

  it('assigns a top-right toolbar to the right strip', () => {
    // 46 wide, 122 tall, 30px from the right edge: right is the thinnest strip.
    const p = computeFitPadding(CANVAS, [box(938, 24, 984 - 16, 146)])
    expect(p.right).toBe(968 - 938 + 12)
    expect(p.top).toBe(24)
    expect(p.left).toBe(24)
    expect(p.bottom).toBe(24)
  })

  it('assigns a top-left back button to the top strip', () => {
    const p = computeFitPadding(CANVAS, [box(16, 24, 157, 54)])
    expect(p.top).toBe(54 + 12)
    expect(p.left).toBe(24)
  })

  it('assigns bottom-left zoom controls to the left strip', () => {
    const p = computeFitPadding(CANVAS, [box(16, 402, 44, 482)])
    expect(p.left).toBe(44 + 12)
    expect(p.bottom).toBe(24)
  })

  it('assigns a bottom-left legend to its cheaper strip (left here: 253 < 290)', () => {
    const p = computeFitPadding(CANVAS, [box(16, 200, 253, 393)])
    expect(p.left).toBe(253 + 12)
    expect(p.bottom).toBe(24)
  })

  it('assigns a bottom-right minimap to the bottom strip', () => {
    const p = computeFitPadding(CANVAS, [box(782, 330, 984, 482)])
    expect(p.bottom).toBe(490 - 330 + 12)
    expect(p.right).toBe(24)
  })

  it('breaks thickness ties in the order top, right, bottom, left', () => {
    const square = { width: 100, height: 100 }
    // Centered square: every strip is equally thick -> top wins.
    expect(computeFitPadding(square, [box(40, 40, 60, 60)], { base: 0, gap: 0 })).toEqual({
      top: 60,
      right: 0,
      bottom: 0,
      left: 0,
    })
    // Thin on right and bottom only (tie) -> right wins over bottom.
    expect(computeFitPadding(square, [box(70, 70, 100, 100)], { base: 0, gap: 0 })).toEqual({
      top: 0,
      right: 30,
      bottom: 0,
      left: 0,
    })
  })

  it('takes the max, not the sum, of several overlays on one side', () => {
    const p = computeFitPadding(CANVAS, [box(16, 402, 44, 482), box(16, 233, 253, 300)])
    // Controls need 44+12 on the left, the legend piece 253+12: max wins.
    expect(p.left).toBe(253 + 12)
  })

  it('honors gap and base', () => {
    const p = computeFitPadding(CANVAS, [box(16, 24, 157, 54)], { base: 40, gap: 30 })
    expect(p.top).toBe(84)
    expect(p.right).toBe(40)
  })

  it('ignores zero-size and inverted boxes', () => {
    const p = computeFitPadding(CANVAS, [box(10, 10, 10, 50), box(10, 10, 50, 10), box(50, 50, 20, 20)])
    expect(p).toEqual({ top: 24, right: 24, bottom: 24, left: 24 })
  })

  it('scales an over-large axis down proportionally and never goes negative', () => {
    const tiny = { width: 200, height: 100 }
    const p = computeFitPadding(tiny, [box(0, 0, 200, 90), box(0, 40, 200, 100)], {})
    expect(p.top + p.bottom).toBeLessThanOrEqual(75)
    expect(p.left + p.right).toBeLessThanOrEqual(150)
    for (const v of Object.values(p)) expect(v).toBeGreaterThanOrEqual(0)
  })

  it('returns integers', () => {
    const p = computeFitPadding(CANVAS, [box(16.4, 24.2, 157.7, 54.3)])
    for (const v of Object.values(p)) expect(Number.isInteger(v)).toBe(true)
  })

  it('keeps every overlay inside the padded-out strip (the content box never touches it)', () => {
    const overlays = [
      box(16, 24, 157, 54), // back
      box(938, 24, 984, 146), // toolbar
      box(16, 233, 253, 393), // legend
      box(16, 402, 44, 482), // controls
      box(782, 330, 984, 482), // minimap
      box(940, 479, 999, 497), // attribution
    ]
    const p = computeFitPadding(CANVAS, overlays)
    const content = box(p.left, p.top, CANVAS.width - p.right, CANVAS.height - p.bottom)
    for (const o of overlays) {
      const intersects =
        Math.min(content.right, o.right) > Math.max(content.left, o.left) &&
        Math.min(content.bottom, o.bottom) > Math.max(content.top, o.top)
      expect(intersects).toBe(false)
    }
  })

  it('does not mutate its inputs', () => {
    const overlays = [box(16, 24, 157, 54)]
    const canvas = { ...CANVAS }
    const before = JSON.stringify({ overlays, canvas })
    computeFitPadding(canvas, overlays)
    expect(JSON.stringify({ overlays, canvas })).toBe(before)
  })
})

describe('toFitViewPadding', () => {
  it('formats all four sides as px strings', () => {
    expect(toFitViewPadding({ top: 1, right: 2, bottom: 3, left: 4 })).toEqual({
      top: '1px',
      right: '2px',
      bottom: '3px',
      left: '4px',
    })
  })
})

describe('measureOverlays', () => {
  /** Assigns a rect to ONE element instance (never to Element.prototype). */
  function withRect(el: HTMLElement, l: number, t: number, w: number, h: number) {
    el.getBoundingClientRect = () =>
      ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} }) as DOMRect
  }

  it('returns canvas size and canvas-relative boxes, skipping zero-size panels and non-panels', () => {
    const root = document.createElement('div')
    const mk = (cls: string) => {
      const el = document.createElement('div')
      el.className = cls
      root.appendChild(el)
      return el
    }
    withRect(root, 100, 50, 968, 490)
    withRect(mk('react-flow__panel top left'), 116, 74, 141, 30)
    withRect(mk('react-flow__panel bottom right react-flow__minimap'), 882, 380, 200, 150)
    withRect(mk('react-flow__panel hidden'), 0, 0, 0, 0)
    withRect(mk('not-a-panel'), 100, 50, 50, 50)

    const { canvas, overlays } = measureOverlays(root)
    expect(canvas).toEqual({ width: 968, height: 490 })
    expect(overlays).toEqual([
      { left: 16, top: 24, right: 157, bottom: 54 },
      { left: 782, top: 330, right: 982, bottom: 480 },
    ])
  })

  it('skips panels marked vc-graph-fit-ignore (the scroll hint)', () => {
    const root = document.createElement('div')
    root.getBoundingClientRect = () => rect(0, 0, 968, 490)
    const hint = document.createElement('div')
    hint.className = 'react-flow__panel top center vc-graph-hint-panel vc-graph-fit-ignore'
    hint.getBoundingClientRect = () => rect(300, 24, 360, 30)
    const back = document.createElement('div')
    back.className = 'react-flow__panel top left'
    back.getBoundingClientRect = () => rect(16, 24, 141, 30)
    root.append(hint, back)
    expect(measureOverlays(root).overlays).toEqual([{ left: 16, top: 24, right: 157, bottom: 54 }])
  })
})

function rect(l: number, t: number, w: number, h: number) {
  return { left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON() {} } as DOMRect
}

// Representative panels at 968x490 (measured in the layout-fixes screenshots).
const BACK = box(16, 24, 157, 54)
const TOOLBAR = box(922, 24, 952, 146)
const LEGEND = box(16, 233, 253, 393)
const CONTROLS = box(16, 402, 44, 482)
const MINIMAP = box(782, 330, 952, 482)
const PANELS = [BACK, TOOLBAR, LEGEND, CONTROLS, MINIMAP]

describe('computeFitPadding scrollAxis', () => {
  it('is identical to the old behavior when scrollAxis is absent', () => {
    expect(computeFitPadding(CANVAS, PANELS, {})).toEqual(computeFitPadding(CANVAS, PANELS))
    expect(computeFitPadding(CANVAS, PANELS, { scrollAxisPenalty: 10 })).toEqual(
      computeFitPadding(CANVAS, PANELS),
    )
  })

  it('moves overlays off the scroll axis (y): no bottom strip beyond the base', () => {
    const p = computeFitPadding(CANVAS, [BACK, MINIMAP], { scrollAxis: 'y' })
    // Without the penalty the minimap takes a 160 px bottom strip.
    expect(computeFitPadding(CANVAS, [BACK, MINIMAP]).bottom).toBeGreaterThan(24)
    expect(p.bottom).toBe(24)
    expect(p.right).toBe(968 - 782 + 12)
    // The default penalty (2) leaves the thin Back button on top; a heavier one moves it left.
    expect(p.top).toBe(54 + 12)
    const heavy = computeFitPadding(CANVAS, [BACK], { scrollAxis: 'y', scrollAxisPenalty: 3 })
    expect(heavy.top).toBe(24)
    expect(heavy.left).toBe(157 + 12)
  })

  it('moves overlays off the scroll axis (x) for TB', () => {
    const p = computeFitPadding(CANVAS, [MINIMAP, CONTROLS], { scrollAxis: 'x' })
    expect(p.left).toBe(24)
    expect(p.right).toBe(24)
    expect(p.bottom).toBe(490 - 330 + 12)
  })

  it('the penalty affects only the choice, not the applied thickness', () => {
    const a = computeFitPadding(CANVAS, [MINIMAP], { scrollAxis: 'y', scrollAxisPenalty: 3 })
    expect(a.right).toBe(968 - 782 + 12)
    expect(a.bottom).toBe(24)
  })

  it('still puts a top-center note on top (side strips would be enormous)', () => {
    const note = box(380, 24, 590, 54)
    expect(computeFitPadding(CANVAS, [note], { scrollAxis: 'y' }).top).toBe(54 + 12)
  })

  it('does not mutate its inputs', () => {
    const overlays = PANELS.map((b) => ({ ...b }))
    const before = JSON.stringify(overlays)
    computeFitPadding(CANVAS, overlays, { scrollAxis: 'y' })
    expect(JSON.stringify(overlays)).toBe(before)
  })
})

describe('readableViewport', () => {
  const free = (p: FitPadding) => ({
    left: p.left,
    top: p.top,
    right: CANVAS.width - p.right,
    bottom: CANVAS.height - p.bottom,
  })
  const P: FitPadding = { top: 24, right: 100, bottom: 24, left: 200 }
  const toScreen = (r: { x: number; y: number; width: number; height: number }, v: { x: number; y: number; zoom: number }) => ({
    left: r.x * v.zoom + v.x,
    top: r.y * v.zoom + v.y,
    right: (r.x + r.width) * v.zoom + v.x,
    bottom: (r.y + r.height) * v.zoom + v.y,
  })

  // LR lane: x 0..1000 (rank axis), y -1400..1400 around the user at y -32..32.
  const bounds = { x: 0, y: -1400, width: 1000, height: 2800 }
  const user = { x: 0, y: -32, width: 200, height: 64 }

  it('start-aligns the rank axis and centers the user on a long cross axis', () => {
    const v = readableViewport(bounds, user, CANVAS, P, 0.65, 0.15, 1.8)
    expect(v.zoom).toBe(0.65)
    // Content 650 px wide vs free 668: fits -> centered, not start-aligned.
    expect(v.x).toBeCloseTo(200 + (668 - 650) / 2, 6)
    const u = toScreen(user, v)
    const f = free(P)
    expect(u.top).toBeGreaterThanOrEqual(f.top)
    expect(u.bottom).toBeLessThanOrEqual(f.bottom)
    expect((u.top + u.bottom) / 2).toBeCloseTo((f.top + f.bottom) / 2, 6)
  })

  it('start-aligns a long rank axis at the free-region start', () => {
    const wide = { x: 0, y: -100, width: 4000, height: 200 }
    const v = readableViewport(wide, { x: 0, y: -32, width: 200, height: 64 }, CANVAS, P, 0.65, 0.15, 1.8)
    expect(v.x).toBe(P.left)
    const u = toScreen({ x: 0, y: -32, width: 200, height: 64 }, v)
    expect(u.left).toBeGreaterThanOrEqual(P.left)
    expect(u.right).toBeLessThanOrEqual(CANVAS.width - P.right)
  })

  it('is top-aligned when the user fits in the aligned window (short lane)', () => {
    const lane = { x: 0, y: -40, width: 1000, height: 1200 }
    const v = readableViewport(lane, { x: 0, y: -32, width: 200, height: 64 }, CANVAS, P, 0.65, 0.15, 1.8)
    expect(v.y).toBeCloseTo(P.top - -40 * 0.65, 6)
  })

  it('centers content that fits an axis', () => {
    const small = { x: 0, y: 0, width: 400, height: 200 }
    const v = readableViewport(small, { x: 0, y: 0, width: 200, height: 64 }, CANVAS, P, 0.65, 0.15, 1.8)
    const s = toScreen(small, v)
    const f = free(P)
    expect((s.left + s.right) / 2).toBeCloseTo((f.left + f.right) / 2, 6)
    expect((s.top + s.bottom) / 2).toBeCloseTo((f.top + f.bottom) / 2, 6)
  })

  it('clamps the zoom to the zoom range', () => {
    expect(readableViewport(bounds, user, CANVAS, P, 0.65, 0.7, 1.8).zoom).toBe(0.7)
    expect(readableViewport(bounds, user, CANVAS, P, 5, 0.15, 1.8).zoom).toBe(1.8)
  })

  it('is deterministic and does not mutate its inputs', () => {
    const b = { ...bounds }
    const a = readableViewport(b, user, CANVAS, P, 0.65, 0.15, 1.8)
    expect(readableViewport(b, user, CANVAS, P, 0.65, 0.15, 1.8)).toEqual(a)
    expect(b).toEqual(bounds)
  })
})

describe('isGraphOutOfView', () => {
  const b = { x: 0, y: 0, width: 400, height: 300 }
  it('is false when wholly inside', () => {
    expect(isGraphOutOfView(b, [10, 10, 1], CANVAS)).toBe(false)
  })
  it('is true when cut on each of the four sides', () => {
    expect(isGraphOutOfView(b, [-50, 10, 1], CANVAS)).toBe(true)
    expect(isGraphOutOfView(b, [10, -50, 1], CANVAS)).toBe(true)
    expect(isGraphOutOfView(b, [700, 10, 1], CANVAS)).toBe(true)
    expect(isGraphOutOfView(b, [10, 300, 1], CANVAS)).toBe(true)
  })
  it('honors the tolerance and the zoom', () => {
    expect(isGraphOutOfView(b, [-1, 0, 1], CANVAS)).toBe(false)
    expect(isGraphOutOfView(b, [-2, 0, 1], CANVAS)).toBe(true)
    expect(isGraphOutOfView(b, [0, 0, 3], CANVAS)).toBe(true)
  })
  it('is false for an unmeasured canvas', () => {
    expect(isGraphOutOfView(b, [5000, 5000, 1], { width: 0, height: 0 })).toBe(false)
  })
})

describe('planFit', () => {
  const input = (bounds: { x: number; y: number; width: number; height: number }, scrollAxis: 'x' | 'y' = 'y') => ({
    bounds,
    focus: { x: bounds.x, y: bounds.y + bounds.height / 2 - 32, width: 200, height: 64 },
    canvas: CANVAS,
    overlays: PANELS,
    minZoom: 0.15,
    maxZoom: 1.8,
    scrollAxis,
  })

  it('keeps the normal overlay-aware fit for a short graph', () => {
    const plan = planFit(input({ x: 0, y: -240, width: 1000, height: 480 }))
    expect(plan.mode).toBe('fit')
    expect(plan.padding).toEqual(computeFitPadding(CANVAS, PANELS))
  })

  it('opens a long LR graph at the readable zoom', () => {
    const plan = planFit(input({ x: 0, y: -1400, width: 1000, height: 2800 }))
    expect(plan.mode).toBe('readable')
    if (plan.mode !== 'readable') return
    expect(plan.viewport.zoom).toBe(READABLE_MIN_ZOOM)
    expect(plan.overflows).toBe(true)
    expect(plan.padding).toEqual(computeFitPadding(CANVAS, PANELS, { scrollAxis: 'y' }))
  })

  it('opens a long TB graph at the readable zoom', () => {
    const plan = planFit(input({ x: -1400, y: 0, width: 2800, height: 600 }, 'x'))
    expect(plan.mode).toBe('readable')
    if (plan.mode !== 'readable') return
    expect(plan.viewport.zoom).toBe(READABLE_MIN_ZOOM)
    expect(plan.padding).toEqual(computeFitPadding(CANVAS, PANELS, { scrollAxis: 'x' }))
  })

  it('treats a fit zoom exactly at the threshold as a normal fit', () => {
    // Find a lane height whose padded fit zoom is exactly SCROLL_MODE_FIT_ZOOM.
    const p = computeFitPadding(CANVAS, PANELS)
    const availH = CANVAS.height - p.top - p.bottom
    const height = availH / SCROLL_MODE_FIT_ZOOM
    expect(planFit(input({ x: 0, y: 0, width: 100, height })).mode).toBe('fit')
    expect(planFit(input({ x: 0, y: 0, width: 100, height: height * 1.05 })).mode).toBe('readable')
  })

  it('keeps the normal fit for an unmeasured (zero-size) canvas', () => {
    const i = { ...input({ x: 0, y: -1400, width: 1000, height: 2800 }), canvas: { width: 0, height: 0 } }
    expect(planFit(i).mode).toBe('fit')
  })

  it('is deterministic and does not mutate its input', () => {
    const i = input({ x: 0, y: -1400, width: 1000, height: 2800 })
    const before = JSON.stringify(i)
    const a = planFit(i)
    expect(planFit(i)).toEqual(a)
    expect(JSON.stringify(i)).toBe(before)
  })
})
