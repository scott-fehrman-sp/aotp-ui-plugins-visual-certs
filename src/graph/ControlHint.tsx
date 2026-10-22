import { cloneElement, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

/**
 * Hover/focus tooltip for the graph control buttons, ported from org-graph's
 * `Hint`. It always opens to the RIGHT of its anchor (the panel is docked to the
 * left edge), vertically centered. The popover is portaled to `document.body`
 * so the canvas' `overflow: hidden` cannot clip it.
 *
 * The anchor is `display: inline-flex` (see GraphControls.css) so it has a real
 * layout box: a `display: contents` wrapper reports an all-zero rect.
 */
export function ControlHint({
  label,
  children,
}: {
  label: string
  /** A single focusable element; it receives `aria-describedby` while open. */
  children: ReactElement<{ 'aria-describedby'?: string }>
}) {
  const [open, setOpen] = useState(false)
  const [point, setPoint] = useState({ x: 0, y: 0 })
  const anchor = useRef<HTMLSpanElement>(null)
  const id = useId()

  const show = () => {
    const rect = anchor.current?.getBoundingClientRect()
    // A truly zero-size box means the anchor is not laid out; positioning from
    // it would pin the tooltip to the origin.
    if (!rect || (rect.width === 0 && rect.height === 0)) return
    setPoint({ x: rect.right, y: rect.top + rect.height / 2 })
    setOpen(true)
  }

  // Escape closes the tooltip first. While it is open the event is consumed so
  // the canvas' window-level Escape (back to the grid) does not also fire.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
  }

  return (
    <span
      className="vc-graph-hint-anchor"
      ref={anchor}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={show}
      onBlurCapture={() => setOpen(false)}
      onKeyDown={onKeyDown}
    >
      {cloneElement(children, { 'aria-describedby': open ? id : undefined })}
      {open
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              className="vc-graph-hint vc-graph-hint-right"
              style={{ left: point.x, top: point.y }}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}
