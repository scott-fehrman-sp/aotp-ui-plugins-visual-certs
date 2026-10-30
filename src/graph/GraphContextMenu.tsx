import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useReactFlow } from '@xyflow/react'
import { StatusIcon } from './AccessNode'
import { ControlIcon, type ControlIconName } from './ControlIcons'
import type { GraphControlItem } from './graphControlItems'
import './GraphContextMenu.css'

/** Where a context menu was opened, and which menu that point asked for. */
export type GraphContextMenuState =
  | { kind: 'canvas'; x: number; y: number }
  | {
      kind: 'decision'
      x: number
      y: number
      /**
       * Access items the actions will change. Empty when the right-clicked
       * item does not need review, which leaves Approve, Revoke, and Reassign
       * disabled.
       */
      nodeIds: string[]
    }

const ZOOM_ITEMS: { id: 'zoom-in' | 'zoom-out' | 'fit'; label: string; icon: ControlIconName }[] = [
  { id: 'zoom-in', label: 'Zoom in', icon: 'zoomIn' },
  { id: 'zoom-out', label: 'Zoom out', icon: 'zoomOut' },
  { id: 'fit', label: 'Fit', icon: 'fit' },
]

/** Review actions on the selected access items that still need a decision. */
const DECISION_ITEMS: { status: 'approved' | 'revoked' | 'reassigned'; label: string }[] = [
  { status: 'approved', label: 'Approve' },
  { status: 'revoked', label: 'Revoke' },
  { status: 'reassigned', label: 'Reassign' },
]

/**
 * Right-click menu for the access canvas, portaled to `document.body` so the
 * canvas' `overflow: hidden` cannot clip it. The canvas menu lists the same
 * actions as the current control panel, then zoom in / out / fit. The decision
 * menu lists Approve, Revoke, and Reassign. Those actions are enabled when
 * `menu.nodeIds` names the access items that still need review.
 */
export function GraphContextMenu({
  menu,
  items,
  motionMs,
  onClose,
  onDecision,
}: {
  menu: GraphContextMenuState
  /** Control-panel actions. Used by the canvas menu; ignored for a decision menu. */
  items: GraphControlItem[]
  /** Duration of a zoom or fit, matching the rest of the canvas motion. */
  motionMs: number
  onClose: () => void
  /** Opens the confirmation for a review action. Ignored by the canvas menu. */
  onDecision?: (status: 'approved' | 'revoked' | 'reassigned') => void
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const rootRef = useRef<HTMLDivElement>(null)
  const position = useClampedPosition(menu.x, menu.y, rootRef)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      onClose()
    }
    // Capture so this runs before the canvas' bubble listener on window, which
    // treats Escape as "back to the user grid".
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const first = root.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
    ;(first ?? root).focus()
  }, [menu.kind, menu.x, menu.y])

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Tab') {
      onClose()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return
    }
    const buttons = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    )
    if (buttons.length === 0) return
    event.preventDefault()
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Home') {
      buttons[0].focus()
      return
    }
    if (event.key === 'End') {
      buttons[buttons.length - 1].focus()
      return
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const next = current === -1 ? 0 : (current + delta + buttons.length) % buttons.length
    buttons[next].focus()
  }

  const zoom = (id: (typeof ZOOM_ITEMS)[number]['id']) => {
    const duration = motionMs
    if (id === 'zoom-in') void zoomIn({ duration })
    else if (id === 'zoom-out') void zoomOut({ duration })
    else void fitView({ duration })
    onClose()
  }

  const label = menu.kind === 'canvas' ? 'Canvas menu' : 'Review actions'

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      className="vc-graph-menu"
      style={{ left: position.left, top: position.top }}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.kind === 'canvas' ? (
        <>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="vc-graph-menu-item"
              onClick={() => {
                item.onSelect()
                onClose()
              }}
            >
              <ControlIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
          <div role="separator" className="vc-graph-menu-separator" />
          {ZOOM_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="vc-graph-menu-item"
              onClick={() => zoom(item.id)}
            >
              <ControlIcon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </>
      ) : (
        DECISION_ITEMS.map((item) => {
          const enabled = menu.nodeIds.length > 0
          return (
            <button
              key={item.status}
              type="button"
              role="menuitem"
              className="vc-graph-menu-item"
              disabled={!enabled}
              onClick={
                enabled
                  ? () => {
                      onDecision?.(item.status)
                      onClose()
                    }
                  : undefined
              }
            >
              <StatusIcon status={item.status} decorative />
              <span>{item.label}</span>
            </button>
          )
        })
      )}
    </div>,
    document.body,
  )
}

/**
 * Pins the menu to the click point, then shifts it back inside the viewport
 * once it has a size. Returning the previous state object when nothing moved
 * keeps the layout effect from rendering again.
 */
function useClampedPosition(
  x: number,
  y: number,
  rootRef: RefObject<HTMLDivElement | null>,
) {
  const [position, setPosition] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = rootRef.current
    const margin = 8
    let left = x
    let top = y
    if (el) {
      const rect = el.getBoundingClientRect()
      const maxLeft = window.innerWidth - margin - rect.width
      const maxTop = window.innerHeight - margin - rect.height
      if (left > maxLeft) left = Math.max(margin, maxLeft)
      if (top > maxTop) top = Math.max(margin, maxTop)
    }
    setPosition((current) =>
      current.left === left && current.top === top ? current : { left, top },
    )
  }, [x, y, rootRef])
  return position
}
