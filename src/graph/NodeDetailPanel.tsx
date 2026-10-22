/**
 * The right-side fly-out detail panel for the access graph.
 *
 * Unlike the hover tooltip (which is transient and anchored to a card), this is
 * a persistent side panel that shows the full detail of whichever node the
 * reviewer last activated — ANY of the five kinds (user, role, access profile,
 * entitlement, source), including reference-only nodes. It is toggled from the
 * control panel's "detail" button and closes with its own close control or when
 * the toggle is turned off.
 *
 * It reads only the small `AccessSceneNodeData` the scene already carries (kind,
 * label, detail, review status, reference flag); the surrounding canvas owns
 * which node is shown. With no node selected it invites the reviewer to pick one
 * rather than rendering empty, so the panel always explains itself.
 *
 * Styling matches the legend panel (`.vc-graph-legend`) — a bordered, shadowed
 * card using the graph tokens — mounted inside a React Flow `top-right` panel.
 */
import type { AccessGraphNodeKind, AccessSceneNodeData } from '../sailpoint/types'
import { KindIcon } from './kindIcons'
import './NodeDetailPanel.css'

/** Human-readable caption per layer (mirrors AccessNode's KIND_LABEL). */
const KIND_LABEL: Record<AccessGraphNodeKind, string> = {
  user: 'User',
  role: 'Role',
  accessProfile: 'Access profile',
  entitlement: 'Entitlement',
  source: 'Source',
}

/** Review-status caption (mirrors AccessNode's STATUS_ICON_LABEL). */
const STATUS_LABEL: Record<NonNullable<AccessSceneNodeData['reviewStatus']>, string> = {
  needsReview: 'Needs review',
  approved: 'Approved',
  revoked: 'Revoked',
  reassigned: 'Reassigned',
}

interface NodeDetailPanelProps {
  /**
   * The data of the node to describe, or `null` when nothing is selected (the
   * panel then shows a short "pick a node" prompt). Carries the same payload the
   * card and tooltip read.
   */
  node: AccessSceneNodeData | null
  /** Hides the panel (turns the control-panel toggle off). */
  onClose: () => void
}

/**
 * A fly-out card describing one access-graph node. Field set adapts to the kind:
 * a user shows department/location; every other kind shows a description. A
 * reviewed first-level item adds its review status; a reference-only node is
 * flagged as context (not reviewed).
 */
export function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  const kindLabel = node ? KIND_LABEL[node.kind] : ''
  const description = node?.detail?.description ?? ''
  const status = node?.reviewStatus
  const isUser = node?.kind === 'user'
  // The user field set, in a fixed order that mirrors the org-graph detail
  // panel. A field renders only when it has a value, so a sparse identity never
  // shows a wall of "not set" lines; Department / Location always render (they
  // anchor the panel even when blank).
  const d = node?.detail ?? {}
  const userRows: Array<[string, string, boolean]> = [
    ['Title', d.title ?? '', false],
    ['Email', d.email ?? '', false],
    ['Phone', d.phone ?? '', false],
    ['Department', d.department ?? '', true],
    ['Location', d.location ?? '', true],
    ['Country', d.country ?? '', false],
    ['Manager', d.manager ?? '', false],
    ['Is manager', d.isManager ?? '', false],
    ['Lifecycle state', d.lifecycleState ?? '', false],
    ['Identity state', d.identityState ?? '', false],
    ['Identity ID', d.identityId ?? '', false],
  ]
  // Keep a field when it has a value or is one of the always-shown anchors
  // (Department / Location anchor the user panel even when blank).
  const visibleUserRows = userRows.filter(([, value, always]) => always || value)

  return (
    <section
      className="vc-graph-detail"
      role="group"
      aria-label="Node details"
    >
      <header className="vc-graph-detail-head">
        <p className="vc-graph-detail-title">Details</p>
        <button
          type="button"
          className="vc-graph-detail-close"
          aria-label="Hide details"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {node === null ? (
        <p className="vc-graph-detail-empty">
          Select a node to see its details here.
        </p>
      ) : (
        <div className="vc-graph-detail-body">
          <div className="vc-graph-detail-kind-row">
            <KindIcon kind={node.kind} className="vc-graph-detail-kind-icon" />
            <span className={`vc-graph-detail-kind kind-${node.kind}`}>
              {kindLabel}
            </span>
          </div>
          <p className="vc-graph-detail-label">{node.label}</p>

          {isUser ? (
            <dl className="vc-graph-detail-fields">
              {visibleUserRows.map(([label, value]) => (
                <div key={label} className="vc-graph-detail-row">
                  <dt>{label}</dt>
                  <dd>
                    {value || (
                      <span className="vc-graph-detail-unset">not set</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <dl className="vc-graph-detail-fields">
              <div className="vc-graph-detail-row">
                <dt>Description</dt>
                <dd>
                  {description || (
                    <span className="vc-graph-detail-unset">not set</span>
                  )}
                </dd>
              </div>
            </dl>
          )}

          {status ? (
            <dl className="vc-graph-detail-fields">
              <div className="vc-graph-detail-row">
                <dt>Review status</dt>
                <dd>
                  {STATUS_LABEL[status]}
                  {node.reviewMixed
                    ? ' (mixed: some items still need review)'
                    : ''}
                </dd>
              </div>
            </dl>
          ) : null}

          {node.reference ? (
            <p className="vc-graph-detail-note">
              Reference only — shown to explain how access derives, not itself
              reviewed.
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
