/**
 * A styled hover/focus tooltip for a graph node.
 *
 * Replaces the plain native `title` attribute on the access-node cards with a
 * themed popover that shows the node's kind and FULL (untruncated) label — the
 * card label itself is ellipsis-clipped, so this is where a reviewer reads the
 * complete name of a role / access profile / entitlement / source.
 *
 * Below the label it surfaces extra per-kind detail when present: a `user`
 * node's DEPARTMENT and LOCATION, or the DESCRIPTION of a
 * role / access profile / entitlement / source. Each line is rendered only when
 * its value is non-empty, so a node with no extra detail shows exactly as
 * before (kind caption + label).
 *
 * It renders through a portal to `document.body` (mirroring org-graph's `Hint`)
 * so the tooltip escapes React Flow's transformed, overflow-hidden canvas and
 * is never clipped by the node card or the pane. Positioning is measured from
 * the anchor's bounding box on open, so it follows the node wherever the canvas
 * is panned or zoomed.
 */
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { AccessGraphNodeKind } from '../sailpoint/types'
import './NodeTooltip.css'

interface NodeTooltipProps {
  /** The per-kind caption, e.g. "Access profile". */
  kindLabel: string
  /** The node's kind, used to tint the tooltip's accent bar. */
  kind: AccessGraphNodeKind
  /** The full, untruncated display name. */
  label: string
  /**
   * Extra detail for the node: a `user`'s `department`/`location` or any other
   * kind's `description`. Each field renders only when non-empty; when all are
   * empty/absent the tooltip shows just the kind caption + label.
   */
  detail?: { description?: string; department?: string; location?: string }
  /** Review status label (e.g. "Needs review") for a reviewed first-level node. */
  reviewStatusLabel?: string
  /** True when the node's first-level items disagree on status. */
  mixed?: boolean
  /** True for a reference-only node (shown for context, not reviewed). */
  reference?: boolean
  /** The node card the tooltip describes and anchors to. */
  children: ReactNode
}

/**
 * Wraps a node card and shows a themed tooltip on hover or keyboard focus.
 * The wrapper FILLS the node box (see NodeTooltip.css `.vc-node-tooltip-anchor`
 * `width/height: 100%`) rather than using `display: contents`, so it has a real
 * layout box: that box is what receives mouse-enter/leave events AND what
 * `getBoundingClientRect` measures for positioning (a `display: contents`
 * wrapper reports a zero rect and would be skipped by the non-zero-rect guard).
 * The inner `.vc-graph-card` already sizes to 100% of this box, so filling the
 * node here does not change the card's appearance.
 */
export function NodeTooltip({
  kindLabel,
  kind,
  label,
  detail,
  reviewStatusLabel,
  mixed,
  reference,
  children,
}: NodeTooltipProps) {
  const [open, setOpen] = useState(false)
  const [point, setPoint] = useState({ x: 0, y: 0 })
  const anchor = useRef<HTMLDivElement>(null)
  const id = useId()

  const show = () => {
    // Measure the actual card box. The anchor wrapper fills the node, so its
    // own rect matches the card; falling back to the first child keeps a sane
    // measurement even if the wrapper box ever collapses.
    const el = anchor.current
    const rect = (
      el?.firstElementChild ?? el
    )?.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) return
    // Centered above the card, with a small gap for the arrow.
    setPoint({ x: rect.left + rect.width / 2, y: rect.top - 8 })
    setOpen(true)
  }
  const hide = () => setOpen(false)

  // Dismiss with Escape without swallowing the card's own Enter/Space handlers.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') hide()
  }

  // Per-kind detail lines, each rendered only when its value is non-empty.
  const department = detail?.department ?? ''
  const location = detail?.location ?? ''
  const description = detail?.description ?? ''
  const showUserDetail = kind === 'user' && (department || location)
  // Role / access profile / entitlement / source always show a Description
  // line; when the node has no description we display "not set" rather than
  // hiding the line, so a reviewer can tell the field is intentionally empty.
  const showDescription = kind !== 'user'
  const hasDescription = description !== ''

  return (
    <div
      className="vc-node-tooltip-anchor"
      ref={anchor}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      onKeyDownCapture={onKeyDown}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              className="vc-node-tooltip"
              style={{ left: point.x, top: point.y }}
            >
              <span className={`vc-node-tooltip-kind kind-${kind}`}>
                {kindLabel}
              </span>
              <span className="vc-node-tooltip-label">{label}</span>
              {showUserDetail ? (
                <div className="vc-node-tooltip-detail">
                  {department ? (
                    <p className="vc-node-tooltip-line">
                      <span className="vc-node-tooltip-field">Department:</span>{' '}
                      <span className="vc-node-tooltip-value">{department}</span>
                    </p>
                  ) : null}
                  {location ? (
                    <p className="vc-node-tooltip-line">
                      <span className="vc-node-tooltip-field">Location:</span>{' '}
                      <span className="vc-node-tooltip-value">{location}</span>
                    </p>
                  ) : null}
                </div>
              ) : null}
              {reviewStatusLabel ? (
                <div className="vc-node-tooltip-detail">
                  <p className="vc-node-tooltip-line">
                    <span className="vc-node-tooltip-field">Review status:</span>{' '}
                    <span className="vc-node-tooltip-value">
                      {reviewStatusLabel}
                      {mixed ? ' (mixed: some items still need review)' : ''}
                    </span>
                  </p>
                </div>
              ) : null}
              {reference ? (
                <div className="vc-node-tooltip-detail">
                  <p className="vc-node-tooltip-line">
                    <span className="vc-node-tooltip-value">Reference Only</span>
                  </p>
                </div>
              ) : null}
              {showDescription ? (
                <div className="vc-node-tooltip-detail">
                  <p className="vc-node-tooltip-line">
                    <span className="vc-node-tooltip-field">Description:</span>{' '}
                    {hasDescription ? (
                      <span className="vc-node-tooltip-value vc-node-tooltip-description">
                        {description}
                      </span>
                    ) : (
                      <span className="vc-node-tooltip-value vc-node-tooltip-unset">
                        not set
                      </span>
                    )}
                  </p>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
