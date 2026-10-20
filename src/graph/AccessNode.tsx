import type { ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { AccessGraphNodeKind, AccessReviewStatus } from '../sailpoint/types'
import type { AccessSceneNode } from './buildAccessScene'
import { NodeTooltip } from './NodeTooltip'

/** Human-readable caption for each layer, shown under the label. */
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
  complete: 'Completed',
  delegated: 'Delegated',
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
  // Check mark.
  complete: (
    <path
      d="M4 9.5 L7.5 13 L14 5.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  // Forward / hand-off arrow.
  delegated: (
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
 * card. Not color-only: each status maps to a distinct SVG SHAPE (hollow
 * exclamation circle / check mark / hand-off arrow) and carries an accessible
 * name via `role="img"` + `aria-label` + a `<title>`, plus a stable
 * `data-review-status` hook. Absolutely positioned via CSS.
 */
export function StatusIcon({
  status,
  decorative = false,
}: {
  status: AccessReviewStatus
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
export function AccessNode({ data }: NodeProps<AccessSceneNode>) {
  const kindLabel = KIND_LABEL[data.kind]
  const status = data.reviewStatus
  // Review status marks only the user's directly-held access item (drill-down).
  const statusClass = status ? ` vc-graph-card-status-${status}` : ''

  // Grid mode: the card is an activatable control that drills into the user.
  if (data.interactive) {
    const activate = () => data.onSelect?.()
    return (
      <NodeTooltip
        kindLabel={kindLabel}
        kind={data.kind}
        label={data.label}
        detail={data.detail}
      >
        <article
          className={`vc-graph-card vc-graph-card-interactive kind-${data.kind}${statusClass}`}
          role="button"
          tabIndex={0}
          aria-label={`Show access for ${data.label}`}
          onClick={activate}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              // Space would otherwise scroll the pane; Enter has no default here.
              event.preventDefault()
              activate()
            }
          }}
        >
          <Handles />
          <strong className="vc-graph-card-label">{data.label}</strong>
          <span className="vc-graph-card-kind">{kindLabel}</span>
          {status ? <StatusIcon status={status} /> : null}
        </article>
      </NodeTooltip>
    )
  }

  // Drill-down mode: the original read-only card markup and a11y.
  return (
    <NodeTooltip
      kindLabel={kindLabel}
      kind={data.kind}
      label={data.label}
      detail={data.detail}
    >
      <article
        className={`vc-graph-card kind-${data.kind}${statusClass}`}
        tabIndex={0}
        aria-label={`${kindLabel}: ${data.label}`}
      >
        <Handles />
        <strong className="vc-graph-card-label">{data.label}</strong>
        <span className="vc-graph-card-kind">{kindLabel}</span>
        {status ? <StatusIcon status={status} /> : null}
      </article>
    </NodeTooltip>
  )
}

/**
 * The eight connection handles (top/bottom/left/right × in/out) the pure scene
 * builder references by id. They are non-interactive and visually hidden; only
 * the rank-facing pair carries an edge for a given direction.
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
