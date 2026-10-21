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
 * `computeFitPadding` / `toFitViewPadding` are pure (no React, no DOM, inputs
 * never mutated). `measureOverlays` is the one DOM read.
 */

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
  const { base = 24, gap = 12, maxFraction = 0.75 } = options
  const padding: FitPadding = { top: base, right: base, bottom: base, left: base }

  for (const box of overlays) {
    if (box.right - box.left <= 0 || box.bottom - box.top <= 0) continue
    const thickness: FitPadding = {
      top: Math.max(0, box.bottom),
      right: Math.max(0, canvas.width - box.left),
      bottom: Math.max(0, canvas.height - box.top),
      left: Math.max(0, box.right),
    }
    let side: (typeof SIDES)[number] = SIDES[0]
    for (const candidate of SIDES) {
      if (thickness[candidate] < thickness[side]) side = candidate
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
 * mounted, notes, attribution). Zero-size panels are skipped.
 */
export function measureOverlays(root: HTMLElement): {
  canvas: { width: number; height: number }
  overlays: Box[]
} {
  const origin = root.getBoundingClientRect()
  const overlays: Box[] = []
  root.querySelectorAll<HTMLElement>('.react-flow__panel').forEach((panel) => {
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
