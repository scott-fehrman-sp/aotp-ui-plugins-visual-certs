import { getViewportForBounds, type Rect } from '@xyflow/react'

/**
 * Overlay-aware fit padding for the access graph.
 *
 * React Flow's `fitView` fits the nodes to the whole canvas rectangle and knows
 * nothing about the widgets drawn on top of it (the legend, minimap, zoom
 * controls, control panel, back button, notes). `computeFitPadding` turns the
 * measured rectangles of those overlays into per-side pixel padding so the
 * fitted graph sits clear of all of them.
 *
 * Strip model: each overlay is assigned to exactly ONE side of the canvas, the
 * side where it needs the thinnest strip, and that side's padding grows to
 * cover the overlay plus a clearance gap. Because every overlay lies fully
 * inside its side's strip and `fitView` keeps the node bounds inside the padded
 * area, no node can touch an overlay. A corner overlay costs a full-width (or
 * full-height) strip, so the graph may be drawn smaller at small viewports;
 * that is intentional.
 *
 * Revised invariant (see {@link planFit}):
 * - Mode A, the graph fits at a zoom >= {@link SCROLL_MODE_FIT_ZOOM}: strict.
 *   After the fit no node intersects an overlay and every node is inside the
 *   canvas.
 * - Mode B, a long graph (fit-everything zoom below that): the view opens at
 *   {@link READABLE_MIN_ZOOM} instead of an illegible hairline. The user card
 *   and the nearest lane items are clear of every overlay; nodes beyond the
 *   canvas, or cut by it, are reached by scrolling or dragging.
 *
 * Everything except `measureOverlays` is pure (no React, no DOM, inputs never
 * mutated). `measureOverlays` is the one DOM read.
 */

/** Zoom a long graph opens at: a 15 px card label is ~9.75 px on screen. */
export const READABLE_MIN_ZOOM = 0.65

/**
 * A graph whose fit-everything zoom is below this is a "long list" and opens
 * at {@link READABLE_MIN_ZOOM}; at or above it the normal overlay-aware fit is
 * kept untouched.
 */
export const SCROLL_MODE_FIT_ZOOM = 0.3

/** A rectangle in canvas-relative pixels (origin = canvas top-left). */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Pixels of padding per canvas side. */
export interface FitPadding {
  top: number
  right: number
  bottom: number
  left: number
}

/** React Flow v12 per-side `fitView` padding (px strings). */
export interface FitViewPadding {
  top: `${number}px`
  right: `${number}px`
  bottom: `${number}px`
  left: `${number}px`
}

export interface FitPaddingOptions {
  /** Minimum margin on every side. Default 24. */
  base?: number
  /** Clearance between an overlay and the graph. Default 12. */
  gap?: number
  /** Max share of an axis the two paddings may take together. Default 0.75. */
  maxFraction?: number
  /**
   * Axis the graph is scrolled along (LR lanes grow down: 'y'; TB: 'x'). Side
   * thicknesses on that axis are multiplied by `scrollAxisPenalty` when an
   * overlay picks its side, so overlays prefer the other axis and the scarce
   * scroll axis stays free. Absent: behavior is unchanged.
   */
  scrollAxis?: 'x' | 'y'
  /** Weight applied to scroll-axis sides in the side choice only. Default 2 (tuned in a real browser: 3 pushed more overlays into the rank axis at 1000x700). */
  scrollAxisPenalty?: number
}

/** Tie-break order when an overlay needs equally thin strips on two sides. */
const SIDES = ['top', 'right', 'bottom', 'left'] as const

/**
 * Per-side padding that keeps a fitted graph clear of every overlay.
 * Overlays with non-positive width or height are ignored. If the paddings on an
 * axis would leave the graph less than `1 - maxFraction` of that axis, both
 * sides are scaled down proportionally (overlap is then possible and accepted).
 */
export function computeFitPadding(
  canvas: { width: number; height: number },
  overlays: readonly Box[],
  options: FitPaddingOptions = {},
): FitPadding {
  const { base = 24, gap = 12, maxFraction = 0.75, scrollAxis, scrollAxisPenalty = 2 } = options
  const padding: FitPadding = { top: base, right: base, bottom: base, left: base }

  for (const box of overlays) {
    if (box.right - box.left <= 0 || box.bottom - box.top <= 0) continue
    const thickness: FitPadding = {
      top: Math.max(0, box.bottom),
      right: Math.max(0, canvas.width - box.left),
      bottom: Math.max(0, canvas.height - box.top),
      left: Math.max(0, box.right),
    }
    // Side choice only: scroll-axis strips are weighted up. The padding that
    // is applied below is always the real thickness.
    const cost = (candidate: (typeof SIDES)[number]) => {
      const onScrollAxis =
        scrollAxis === 'y'
          ? candidate === 'top' || candidate === 'bottom'
          : scrollAxis === 'x' && (candidate === 'left' || candidate === 'right')
      return thickness[candidate] * (onScrollAxis ? scrollAxisPenalty : 1)
    }
    let side: (typeof SIDES)[number] = SIDES[0]
    for (const candidate of SIDES) {
      if (cost(candidate) < cost(side)) side = candidate
    }
    padding[side] = Math.max(padding[side], thickness[side] + gap)
  }

  const capAxis = (a: 'top' | 'left', b: 'bottom' | 'right', extent: number) => {
    const cap = maxFraction * extent
    const sum = padding[a] + padding[b]
    if (sum > cap && sum > 0) {
      const scale = Math.max(cap, 0) / sum
      padding[a] = Math.floor(padding[a] * scale)
      padding[b] = Math.floor(padding[b] * scale)
    }
  }
  capAxis('top', 'bottom', canvas.height)
  capAxis('left', 'right', canvas.width)

  return {
    top: Math.ceil(padding.top),
    right: Math.ceil(padding.right),
    bottom: Math.ceil(padding.bottom),
    left: Math.ceil(padding.left),
  }
}

/** Formats {@link FitPadding} as React Flow's per-side `fitView` padding. */
export function toFitViewPadding(p: FitPadding): FitViewPadding {
  return {
    top: `${p.top}px`,
    right: `${p.right}px`,
    bottom: `${p.bottom}px`,
    left: `${p.left}px`,
  }
}

/**
 * Reads the canvas size and the canvas-relative rectangles of every React Flow
 * panel under `root` (toolbar, back button, legend, controls, minimap when
 * mounted, notes, attribution). Zero-size panels and panels marked `.vc-graph-fit-ignore` (the scroll hint,
 * which sits inside the band the back button already reserves) are skipped.
 */
export function measureOverlays(root: HTMLElement): {
  canvas: { width: number; height: number }
  overlays: Box[]
} {
  const origin = root.getBoundingClientRect()
  const overlays: Box[] = []
  root.querySelectorAll<HTMLElement>('.react-flow__panel').forEach((panel) => {
    if (panel.classList.contains('vc-graph-fit-ignore')) return
    const rect = panel.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    overlays.push({
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      right: rect.right - origin.left,
      bottom: rect.bottom - origin.top,
    })
  })
  return { canvas: { width: origin.width, height: origin.height }, overlays }
}

/** A viewport transform (React Flow's `{ x, y, zoom }`). */
export interface ViewportTransform {
  x: number
  y: number
  zoom: number
}

/** The plan for one refit: the normal fit, or the readable-zoom viewport. */
export type FitPlan =
  | { mode: 'fit'; padding: FitPadding }
  | {
      mode: 'readable'
      viewport: ViewportTransform
      padding: FitPadding
      /** Whether the scaled graph does not fit wholly inside the canvas. */
      overflows: boolean
    }

export interface PlanFitInput {
  /** Bounds of every node, in flow coordinates. */
  bounds: Rect
  /** Bounds of the node to keep in view (the user card), flow coordinates. */
  focus: Rect
  canvas: { width: number; height: number }
  overlays: readonly Box[]
  minZoom: number
  maxZoom: number
  /** Axis the graph scrolls along (LR: 'y', TB: 'x'). */
  scrollAxis: 'x' | 'y'
}

/**
 * Translation along one axis. Content that fits the free region is centered.
 * Otherwise the content START is aligned to the region start if the focus box
 * is then fully inside the region, else the focus box is centered (the user
 * sits mid-lane, so a long lane cannot be start-aligned without losing it).
 */
function axisTranslate(
  min: number,
  max: number,
  focusMin: number,
  focusMax: number,
  zoom: number,
  freeStart: number,
  freeEnd: number,
): number {
  const free = freeEnd - freeStart
  if ((max - min) * zoom <= free) return freeStart + (free - (max - min) * zoom) / 2 - min * zoom
  if ((focusMax - min) * zoom <= free) return freeStart - min * zoom
  return freeStart + (free - (focusMax - focusMin) * zoom) / 2 - focusMin * zoom
}

/**
 * The viewport for a long graph: `zoom` (clamped to the zoom range) with each
 * axis placed by {@link axisTranslate} inside the overlay-free region (the
 * canvas minus `padding`). Pure.
 */
export function readableViewport(
  bounds: Rect,
  focus: Rect,
  canvas: { width: number; height: number },
  padding: FitPadding,
  zoom: number,
  minZoom: number,
  maxZoom: number,
): ViewportTransform {
  const z = Math.min(maxZoom, Math.max(minZoom, zoom))
  return {
    x: axisTranslate(
      bounds.x,
      bounds.x + bounds.width,
      focus.x,
      focus.x + focus.width,
      z,
      padding.left,
      canvas.width - padding.right,
    ),
    y: axisTranslate(
      bounds.y,
      bounds.y + bounds.height,
      focus.y,
      focus.y + focus.height,
      z,
      padding.top,
      canvas.height - padding.bottom,
    ),
    zoom: z,
  }
}

/**
 * Whether the graph bounds are not wholly inside the canvas at `transform`
 * (more than `tolerance` px past any edge). An unmeasured (non-positive) canvas
 * is never "out of view". Pure.
 */
export function isGraphOutOfView(
  bounds: Rect,
  transform: readonly [number, number, number],
  canvas: { width: number; height: number },
  tolerance = 1,
): boolean {
  if (canvas.width <= 0 || canvas.height <= 0) return false
  const [tx, ty, zoom] = transform
  const left = bounds.x * zoom + tx
  const top = bounds.y * zoom + ty
  const right = left + bounds.width * zoom
  const bottom = top + bounds.height * zoom
  return (
    left < -tolerance ||
    top < -tolerance ||
    right > canvas.width + tolerance ||
    bottom > canvas.height + tolerance
  )
}

/**
 * Decides how to fit the drill-down graph. When the fit-everything zoom (with
 * the normal overlay-aware padding) is at or above {@link SCROLL_MODE_FIT_ZOOM}
 * the result is `{ mode: 'fit' }`, i.e. exactly today's fit. Otherwise the
 * graph is a long list: the overlays are re-assigned with the scroll axis
 * penalized (so the scroll axis keeps its length) and the viewport opens at
 * {@link READABLE_MIN_ZOOM}, content start-aligned (or the user centered, see
 * {@link axisTranslate}) in the overlay-free region. An unmeasured canvas
 * (zero size) always gets the normal fit. Pure.
 */
export function planFit(input: PlanFitInput): FitPlan {
  const { bounds, focus, canvas, overlays, minZoom, maxZoom, scrollAxis } = input
  const padding = computeFitPadding(canvas, overlays)
  // An unmeasured canvas cannot be planned for: keep the normal fit.
  if (canvas.width <= 0 || canvas.height <= 0) return { mode: 'fit', padding }
  const fitZoom = getViewportForBounds(
    bounds,
    canvas.width,
    canvas.height,
    minZoom,
    maxZoom,
    toFitViewPadding(padding),
  ).zoom
  if (fitZoom >= SCROLL_MODE_FIT_ZOOM) return { mode: 'fit', padding }

  const readablePadding = computeFitPadding(canvas, overlays, { scrollAxis })
  const viewport = readableViewport(
    bounds,
    focus,
    canvas,
    readablePadding,
    READABLE_MIN_ZOOM,
    minZoom,
    maxZoom,
  )
  return {
    mode: 'readable',
    viewport,
    padding: readablePadding,
    overflows: isGraphOutOfView(bounds, [viewport.x, viewport.y, viewport.zoom], canvas),
  }
}
