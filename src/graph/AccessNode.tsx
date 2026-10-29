import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { AccessGraphNodeKind, AccessReviewStatus } from '../sailpoint/types'
import { NODE_USER_HEIGHT, NODE_WIDTH, type AccessSceneNode } from './buildAccessScene'
import { EmphasisContext } from './EmphasisContext'
import { SelectionContext } from './SelectionContext'
import { isSelectableNodeData } from './selectEdges'
import { KindIcon } from './kindIcons'

/** Kinds a reviewer treats as access items. User, attribute, and source cards are not. */
const ACCESS_ITEM_KINDS = new Set<AccessGraphNodeKind>(['role', 'accessProfile', 'entitlement'])

const DESCRIPTION_UNSET = 'Description not set'

/** The item's description, or a fixed line when that value was never set. */
function accessItemDescription(description: string | undefined): string {
  const text = description?.trim() ?? ''
  return text.length > 0 ? text : DESCRIPTION_UNSET
}

/**
 * Hover/focus description for one access-item card. Portaled to `document.body`
 * so the canvas' `overflow: hidden` cannot clip it. Sits just below the card
 * and stays out of the pointer so it never steals the hover from the card.
 */
function AccessItemTooltip({
  anchor,
  id,
  text,
}: {
  anchor: RefObject<HTMLElement | null>
  id: string
  text: string
}) {
  const tipRef = useRef<HTMLDivElement>(null)
  const [point, setPoint] = useState({ left: 0, top: 0 })

  useLayoutEffect(() => {
    const card = anchor.current
    const tip = tipRef.current
    if (!card || !tip) return
    const cardRect = card.getBoundingClientRect()
    const tipRect = tip.getBoundingClientRect()
    const gap = 8
    const margin = 8
    let left = cardRect.left + cardRect.width / 2 - tipRect.width / 2
    let top = cardRect.bottom + gap
    const maxLeft = window.innerWidth - tipRect.width - margin
    const maxTop = window.innerHeight - tipRect.height - margin
    left = Math.max(margin, Math.min(left, maxLeft))
    if (top > maxTop) top = cardRect.top - tipRect.height - gap
    top = Math.max(margin, Math.min(top, maxTop))
    setPoint((prev) => (prev.left === left && prev.top === top ? prev : { left, top }))
  }, [anchor, text])

  return createPortal(
    <div
      ref={tipRef}
      id={id}
      role="tooltip"
      className="vc-graph-card-tip"
      style={{ left: point.left, top: point.top }}
    >
      {text}
    </div>,
    document.body,
  )
}

/** Human-readable caption for each layer. Used for the card's accessible name
 * and the detail panel; the card itself shows a per-kind icon instead of this
 * text. */
const KIND_LABEL: Record<AccessGraphNodeKind, string> = {
  user: 'User',
  role: 'Role',
  accessProfile: 'Access profile',
  entitlement: 'Entitlement',
  attribute: 'Attribute',
  source: 'Source',
}

/** Accessible name per review status, used for the corner status icon. */
const STATUS_ICON_LABEL: Record<AccessReviewStatus, string> = {
  needsReview: 'Needs review',
  approved: 'Approved',
  revoked: 'Revoked',
  reassigned: 'Reassigned',
}

/** Distinct SVG shape per status so status never relies on color alone. */
const STATUS_ICON_SHAPE: Record<AccessReviewStatus, ReactNode> = {
  // Hollow circle with an exclamation mark.
  needsReview: (
    <>
      <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="9" y1="5" x2="9" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="12.6" r="1" fill="currentColor" />
    </>
  ),
  // Check mark (reviewer KEPT the access).
  approved: (
    <path
      d="M4 9.5 L7.5 13 L14 5.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // X / crossed strokes (reviewer REMOVED the access) — clearly distinct from
  // the check mark.
  revoked: (
    <>
      <line x1="5" y1="5" x2="13" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="13" y1="5" x2="5" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  // Forward / hand-off arrow (handed to someone else to review).
  reassigned: (
    <path
      d="M3 9 H12 M9 5.5 L13 9 L9 12.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
}

/**
 * The review-status icon rendered in the lower-right corner of an access-item
 * card. Not color-only: each of the four statuses maps to a distinct SVG SHAPE
 * (needsReview → hollow exclamation circle; approved → check mark; revoked → X;
 * reassigned → hand-off arrow) and carries an accessible name via `role="img"` +
 * `aria-label` + a `<title>`, plus a stable `data-review-status` hook.
 * Absolutely positioned via CSS.
 */
export function StatusIcon({
  status,
  decorative = false,
  id,
}: {
  status: AccessReviewStatus
  /** Optional DOM id, so a card can point `aria-describedby` at its icon. */
  id?: string
  /**
   * When true the icon is purely decorative (hidden from the a11y tree) — used
   * in the detail panel and the legend, where an adjacent text label already
   * names the status. On a node card it defaults to false so the icon carries
   * the accessible name.
   */
  decorative?: boolean
}) {
  const label = STATUS_ICON_LABEL[status]
  const a11y = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img', 'aria-label': label }
  return (
    <svg
      id={id}
      className={`vc-graph-status-icon vc-graph-status-icon-${status}`}
      data-review-status={status}
      viewBox="0 0 18 18"
      width="18"
      height="18"
      {...a11y}
    >
      {decorative ? null : <title>{label}</title>}
      {STATUS_ICON_SHAPE[status]}
    </svg>
  )
}

/**
 * The manager badge shown in a USER card's bottom-right corner when the identity
 * manages others. Replicates org-graph's `.manager-mark` (an amber pill holding
 * the `reports` org-chart glyph) so the signal reads identically across the two
 * apps. `role="img"` + `aria-label` name it for assistive tech.
 */
function ManagerIcon() {
  return (
    <span className="vc-graph-manager-mark" role="img" aria-label="Manager">
      <svg
        className="vc-graph-manager-icon"
        viewBox="0 0 24 24"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <circle cx="12" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="18" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18" cy="18" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 7v4M12 11 6.8 16M12 11l5.2 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

/** True when the node is a USER card whose identity manages others. */
function isManagerUser(data: AccessSceneNode['data']): boolean {
  return data.kind === 'user' && data.detail?.isManager === 'Yes'
}

/**
 * The person glyph plus this user's completion, anchored together in the
 * card's lower-left corner. The visible text is "X% (Y of Z)"; a
 * screen-reader-only phrase names what those numbers measure. The card points
 * `aria-describedby` at `id`.
 */
function UserProgress({
  percent,
  completed,
  total,
  id,
}: {
  percent: number
  completed: number
  total: number
  id: string
}) {
  const summary = `${percent}% (${completed} of ${total})`
  return (
    <span className="vc-graph-card-user-progress">
      <KindIcon kind="user" className="vc-graph-card-kind-icon" />
      <span className="vc-graph-card-complete" aria-hidden="true">
        {summary}
      </span>
      <span id={id} className="sr-only">
        {summary} of access items completed
      </span>
    </span>
  )
}

/**
 * The number of entitlements that use this attribute, pinned to the attribute
 * card's lower-right corner. The visible text is the bare count; a
 * screen-reader-only phrase names what it counts. The card points
 * `aria-describedby` at `id`.
 */
function EntitlementCount({ count, id }: { count: string; id: string }) {
  const phrase = count === '1' ? '1 entitlement' : `${count} entitlements`
  return (
    <span className="vc-graph-card-entitlement-count">
      <span aria-hidden="true">{count}</span>
      <span id={id} className="sr-only">
        {phrase}
      </span>
    </span>
  )
}

/** The lower-left kind glyph. User cards pair it with their completion percentage. */
function CardKindMark({
  data,
  progressId,
}: {
  data: AccessSceneNode['data']
  progressId: string
}) {
  if (data.kind === 'user' && data.completion) {
    return (
      <UserProgress
        percent={data.completion.percent}
        completed={data.completion.completed}
        total={data.completion.total}
        id={progressId}
      />
    )
  }
  return <KindIcon kind={data.kind} className="vc-graph-card-kind-icon" />
}

/**
 * The inside of a card: the name line plus, for a USER node, the identity
 * lines an operator uses to choose who to review — title, department,
 * location, and country — whenever the detail carries them. The name is
 * "First Last" once the identity lookup has filled those fields, and the
 * review item's display name until then. The name is struck through when the identity's
 * LIFECYCLE STATE is set and is anything other than "active" (case-insensitive),
 * signalling an inactive / terminated identity. Non-user cards and users without
 * extra detail render exactly the bare name line as before.
 */
function CardBody({ data }: { data: AccessSceneNode['data'] }) {
  const isUser = data.kind === 'user'
  const detail = data.detail
  // The lifecycle state (e.g. "active") is the signal, NOT the identity state
  // (e.g. "UNREGISTERED") — a registered-but-provisioning identity can be
  // lifecycle-active while its identity state is unregistered.
  const lifecycle = detail?.lifecycleState ?? ''
  // Struck through only when the lifecycle state is KNOWN and not active; an
  // unset state leaves the name untouched (we cannot assert it is inactive).
  const inactive = isUser && lifecycle !== '' && lifecycle.toLowerCase() !== 'active'

  const name = isUser
    ? [detail?.firstName, detail?.lastName].filter(Boolean).join(' ') || data.label
    : data.label
  const infoLines: string[] = isUser
    ? [detail?.title ?? '', detail?.department ?? '', detail?.location ?? '', detail?.country ?? ''].filter(Boolean)
    : []

  return (
    <>
      <strong
        className={`vc-graph-card-label${inactive ? ' vc-graph-card-label-inactive' : ''}`}
      >
        {name}
      </strong>
      {infoLines.map((line, index) => (
        <span key={index} className="vc-graph-card-info">
          {line}
        </span>
      ))}
    </>
  )
}

function AccessNodeView({
  id,
  data,
  showHandles,
  onActivate,
  autoFocus = false,
}: {
  id: string
  data: AccessSceneNode['data']
  /** Connection handles. Omitted on the pinned drill-down user card. */
  showHandles: boolean
  /** Opens this card's detail. Set only for the pinned user card. */
  onActivate?: () => void
}) {
  const { setHover, setFocus } = useContext(EmphasisContext)
  const { selectedIds, lineageNodeIds, toggle } = useContext(SelectionContext)
  const statusIconId = useId()
  const progressId = useId()
  const countId = useId()
  const tipId = useId()
  const cardRef = useRef<HTMLElement>(null)
  const [showTip, setShowTip] = useState(false)
  const kindLabel = KIND_LABEL[data.kind]
  const completionDescribedBy =
    data.kind === 'user' && data.completion ? progressId : undefined
  const entitlementCount =
    data.kind === 'attribute' ? data.detail?.entitlementCount : undefined
  const countDescribedBy = entitlementCount ? countId : undefined
  const status = data.reviewStatus
  // Review status marks only the user's directly-held access item (drill-down).
  const statusClass =
    (status ? ` vc-graph-card-status-${status}` : '') +
    (data.reference ? ' vc-graph-card-reference' : '')

  // Grid mode: the card is an activatable control that drills into the user.
  // User cards have no description tooltip. The full untruncated name stays
  // available to assistive tech via `aria-label`.
  if (data.interactive) {
    const activate = () => data.onSelect?.()
    return (
      <>
        <article
          className={`vc-graph-card vc-graph-card-interactive kind-${data.kind}${statusClass}`}
          role="button"
          tabIndex={0}
          aria-label={`Show access for ${data.label}`}
          aria-describedby={completionDescribedBy}
          data-review-status={status}
          onClick={activate}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              // Space would otherwise scroll the pane; Enter has no default here.
              event.preventDefault()
              activate()
            }
          }}
        >
          <CardBody data={data} />
          <CardKindMark data={data} progressId={progressId} />
          {entitlementCount ? (
            <EntitlementCount count={entitlementCount} id={countId} />
          ) : null}
          {status ? <StatusIcon status={status} /> : null}
          {isManagerUser(data) ? <ManagerIcon /> : null}
        </article>
        {/* Sibling of the card, not a child: see `Handles`. */}
        <Handles />
      </>
    )
  }

  // Hover / keyboard focus on a FIRST-LEVEL item raises its status edge (see
  // `emphasizeEdges`). Leave/blur only clear their own id so a quick move from
  // one card to the next never wipes the newer emphasis.
  const selectable = isSelectableNodeData(data)
  const isAccessItem = ACCESS_ITEM_KINDS.has(data.kind)
  const emphasisHandlers = selectable
    ? {
        onMouseEnter: () => {
          setHover(id)
          if (isAccessItem) setShowTip(true)
        },
        onMouseLeave: () => {
          setHover((cur) => (cur === id ? null : cur))
          if (isAccessItem) setShowTip(false)
        },
        onFocus: () => {
          setFocus(id)
          if (isAccessItem) setShowTip(true)
        },
        onBlur: () => {
          setFocus((cur) => (cur === id ? null : cur))
          if (isAccessItem) setShowTip(false)
        },
      }
    : {}

  // Selection (see `highlightEdges`): every card except the user is a toggle
  // button. Mouse selection goes through the canvas's node click; the keyboard
  // is handled here. Needs-review access items can be pressed together; other
  // cards are pressed one at a time. Reference cards on a highlighted path are
  // shown at full strength, the other reference cards are muted. A selected
  // card itself is never muted.
  const selected = selectable && selectedIds.has(id)
  const inLineage = data.reference && lineageNodeIds.has(id)
  const referenceDimmed =
    data.reference && selectedIds.size > 0 && !selectedIds.has(id) && !inLineage
  const selectionClass =
    (selectable ? ' vc-graph-card-selectable' : '') +
    (selected ? ' vc-graph-card-selected' : '') +
    (inLineage ? ' vc-graph-card-lineage' : '') +
    (referenceDimmed ? ' vc-graph-card-reference-dim' : '')
  const selectionProps = selectable
    ? {
        role: 'button',
        'aria-pressed': selected,
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            // Space would otherwise scroll the pane.
            event.preventDefault()
            toggle(id)
          }
        },
      }
    : {}

  // Drill-down: first-level cards are also toggle buttons. Access items show
  // their description on hover and keyboard focus. The card keeps its full
  // untruncated name via `aria-label` and its hover/focus edge emphasis.
  const describedBy =
    [
      status ? statusIconId : null,
      showTip ? tipId : null,
      completionDescribedBy,
      countDescribedBy,
    ]
      .filter((value) => value)
      .join(' ') || undefined
  return (
    <>
      <article
        ref={cardRef}
        className={`vc-graph-card kind-${data.kind}${statusClass}${selectionClass}`}
        tabIndex={0}
        aria-label={`${kindLabel}: ${data.label}`}
        data-review-status={status}
        {...selectionProps}
        {...emphasisHandlers}
        {...(onActivate
          ? {
              onClick: onActivate,
              onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onActivate()
                }
              },
            }
          : {})}
        aria-describedby={describedBy}
      >
        <CardBody data={data} />
        <CardKindMark data={data} progressId={progressId} />
        {entitlementCount ? (
          <EntitlementCount count={entitlementCount} id={countId} />
        ) : null}
        {status ? <StatusIcon status={status} id={statusIconId} /> : null}
        {isManagerUser(data) ? <ManagerIcon /> : null}
      </article>
      {showTip ? (
        <AccessItemTooltip
          anchor={cardRef}
          id={tipId}
          text={accessItemDescription(data.detail?.description)}
        />
      ) : null}
      {/* Sibling of the card, not a child: see `Handles`. */}
      {showHandles ? <Handles /> : null}
    </>
  )
}

/** React Flow node. The grid and every access-item card use this. */
export function AccessNode(props: NodeProps<AccessSceneNode>) {
  return <AccessNodeView id={props.id} data={props.data} showHandles />
}

/**
 * The drilled-in user, drawn at the layout card size but outside the graph:
 * the canvas pins it in the upper left, beside the control panel, so it does
 * not pan or zoom with the access items.
 */
export function PinnedAccessCard({
  id,
  data,
  onActivate,
  onContextMenu,
}: {
  id: string
  data: AccessSceneNode['data']
  onActivate: () => void
  /** Right-click on the pinned user. The canvas uses this to suppress the menu. */
  onContextMenu?: (event: MouseEvent) => void
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  // The grid card that was focused is marked inert as it leaves, which drops
  // focus to the page. Restore it here, after that, so the pinned card keeps it.
  useEffect(() => {
    frameRef.current?.querySelector<HTMLElement>('article')?.focus()
  }, [])
  return (
    <div
      ref={frameRef}
      className="vc-graph-user-pin-frame"
      style={{ width: NODE_WIDTH, height: NODE_USER_HEIGHT }}
      onContextMenu={onContextMenu}
    >
      <AccessNodeView id={id} data={data} showHandles={false} onActivate={onActivate} />
    </div>
  )
}

/**
 * The eight connection handles (top/bottom/left/right × in/out) the pure scene
 * builder references by id. They are non-interactive and visually hidden; only
 * the rank-facing pair carries an edge for a given direction.
 *
 * Render them OUTSIDE `.vc-graph-card`, as direct children of the React Flow
 * node wrapper. The card is scaled to 94% while entering/exiting/revealing and
 * has an uneven border (4px left stripe), and React Flow measures handle
 * offsets once with `getBoundingClientRect` and caches them (`measured` keeps
 * them across scene updates). Inside the card the cached offsets would be
 * those of a shrunken, padded box; on the wrapper (never scaled, no border,
 * exactly the node size) the edge endpoints sit on the outer border midpoints.
 */
function Handles() {
  const spots = [
    ['top-in', 'target', Position.Top],
    ['top-out', 'source', Position.Top],
    ['bottom-in', 'target', Position.Bottom],
    ['bottom-out', 'source', Position.Bottom],
    ['left-in', 'target', Position.Left],
    ['left-out', 'source', Position.Left],
    ['right-in', 'target', Position.Right],
    ['right-out', 'source', Position.Right],
  ] as const
  return (
    <>
      {spots.map(([handleId, type, position]) => (
        <Handle
          key={handleId}
          id={handleId}
          className="vc-graph-handle"
          type={type}
          position={position}
          isConnectable={false}
        />
      ))}
    </>
  )
}
