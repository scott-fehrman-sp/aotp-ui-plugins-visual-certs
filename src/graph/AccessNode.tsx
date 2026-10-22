import { useContext, useId, type KeyboardEvent, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { AccessGraphNodeKind, AccessReviewStatus } from '../sailpoint/types'
import type { AccessSceneNode } from './buildAccessScene'
import { EmphasisContext } from './EmphasisContext'
import { SelectionContext } from './SelectionContext'
import { isSelectableNodeData } from './selectEdges'
import { KindIcon } from './kindIcons'

/** Human-readable caption for each layer. Used for the card's accessible name
 * and the detail panel; the card itself shows a per-kind icon instead of this
 * text. */
const KIND_LABEL: Record<AccessGraphNodeKind, string> = {
  user: 'User',
  role: 'Role',
  accessProfile: 'Access profile',
  entitlement: 'Entitlement',
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
   * in the legend where an adjacent text label already names the status. On a
   * node card it defaults to false so the icon carries the accessible name.
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
 * The custom React Flow node for the access graph: a small accessible card
 * showing the node's label and a per-kind caption, with a left-border accent
 * driven by the `kind-<kind>` class. Mirrors org-graph's `PersonNode` shape
 * (8-handle a11y card, per-kind accent) trimmed to a read-only label — the
 * access graph has no per-node actions.
 */
export function AccessNode({ id, data }: NodeProps<AccessSceneNode>) {
  const { setHover, setFocus } = useContext(EmphasisContext)
  const { selectedId, lineageNodeIds, toggle } = useContext(SelectionContext)
  const statusIconId = useId()
  const kindLabel = KIND_LABEL[data.kind]
  const status = data.reviewStatus
  // Review status marks only the user's directly-held access item (drill-down).
  const statusClass =
    (status ? ` vc-graph-card-status-${status}` : '') +
    (data.reference ? ' vc-graph-card-reference' : '')

  // Grid mode: the card is an activatable control that drills into the user.
  // The hover tooltip was removed (the right-side detail panel now carries the
  // kind / full label / detail / status), so the card renders bare; its full
  // untruncated name stays available to assistive tech via `aria-label`.
  if (data.interactive) {
    const activate = () => data.onSelect?.()
    return (
      <>
        <article
          className={`vc-graph-card vc-graph-card-interactive kind-${data.kind}${statusClass}`}
          role="button"
          tabIndex={0}
          aria-label={`Show access for ${data.label}`}
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
          <strong className="vc-graph-card-label">{data.label}</strong>
          <KindIcon kind={data.kind} className="vc-graph-card-kind-icon" />
          {status ? <StatusIcon status={status} /> : null}
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
  const emphasisHandlers = selectable
    ? {
        onMouseEnter: () => setHover(id),
        onMouseLeave: () => setHover((cur) => (cur === id ? null : cur)),
        onFocus: () => setFocus(id),
        onBlur: () => setFocus((cur) => (cur === id ? null : cur)),
      }
    : {}

  // Selection (see `highlightEdges`): a first-level card is a toggle button.
  // Mouse selection goes through the canvas's node click; the keyboard is
  // handled here. Reference-only cards in the selected item's lineage are shown
  // at full strength, the other reference cards are muted.
  const selected = selectable && selectedId === id
  const inLineage = data.reference && lineageNodeIds.has(id)
  const referenceDimmed = data.reference && selectedId !== null && !inLineage
  const selectionClass =
    (selectable ? ' vc-graph-card-selectable' : '') +
    (selected ? ' vc-graph-card-selected' : '') +
    (inLineage ? ' vc-graph-card-lineage' : '') +
    (referenceDimmed ? ' vc-graph-card-reference-dim' : '')
  const selectionProps = selectable
    ? {
        role: 'button',
        'aria-pressed': selected,
        // role=button replaces the card's child semantics, so point at the
        // corner icon to keep the review status announced.
        'aria-describedby': status ? statusIconId : undefined,
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            // Space would otherwise scroll the pane.
            event.preventDefault()
            toggle(id)
          }
        },
      }
    : {}

  // Drill-down mode: the read-only card markup and a11y; first-level cards are
  // also toggle buttons. The hover tooltip was removed (the detail panel now
  // carries the kind / full label / detail / status); the card keeps its full
  // untruncated name via `aria-label` and its hover/focus edge emphasis.
  return (
    <>
      <article
        className={`vc-graph-card kind-${data.kind}${statusClass}${selectionClass}`}
        tabIndex={0}
        aria-label={`${kindLabel}: ${data.label}`}
        data-review-status={status}
        {...selectionProps}
        {...emphasisHandlers}
      >
        <strong className="vc-graph-card-label">{data.label}</strong>
        <KindIcon kind={data.kind} className="vc-graph-card-kind-icon" />
        {status ? <StatusIcon status={status} id={statusIconId} /> : null}
      </article>
      {/* Sibling of the card, not a child: see `Handles`. */}
      <Handles />
    </>
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
