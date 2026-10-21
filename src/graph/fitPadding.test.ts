import { describe, expect, it } from 'vitest'
import {
  computeFitPadding,
  measureOverlays,
  toFitViewPadding,
  type Box,
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
})
