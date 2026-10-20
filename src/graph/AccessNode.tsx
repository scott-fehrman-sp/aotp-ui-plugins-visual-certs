import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { AccessGraphNodeKind } from '../sailpoint/types'
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

/** Chip text per review status, shown on the user's directly-held access item. */
const STATUS_CHIP_LABEL = {
  needsReview: 'Needs review',
  complete: 'Reviewed',
} as const

/**
 * The review-status chip rendered inside an access-item card. Not color-only:
 * it carries its own text ("Needs review" / "Reviewed") plus an `aria-label`
 * and a stable `data-review-status` hook, so status reads without relying on
 * color.
 */
function StatusChip({ status }: { status: 'needsReview' | 'complete' }) {
  const text = STATUS_CHIP_LABEL[status]
  return (
    <span
      className={`vc-graph-status-chip vc-graph-status-chip-${status}`}
      data-review-status={status}
      aria-label={`Review status: ${text}`}
    >
      {text}
    </span>
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
          {status ? <StatusChip status={status} /> : null}
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
        {status ? <StatusChip status={status} /> : null}
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
