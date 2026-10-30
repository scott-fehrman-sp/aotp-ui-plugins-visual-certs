/**
 * The drill-down node legend. Three columns — Types, Status, and Flags — with a
 * vertical rule between them. Types is one row per graph layer, Status is the
 * four review-status icons, and Flags is each certification access flag with
 * its short name. The user grid does not mount it.
 */
import { ACCESS_FLAG_LABEL, ACCESS_FLAG_ORDER } from '../domain/accessFlags'
import type { AccessGraphNodeKind, AccessReviewStatus } from '../sailpoint/types'
import { StatusIcon } from './AccessNode'
import { FlagIcon } from './flagIcons'
import { KindIcon } from './kindIcons'

/** Layer order, user → source, matching the access-graph lanes. */
const LEGEND_KINDS: readonly { kind: AccessGraphNodeKind; label: string }[] = [
  { kind: 'user', label: 'User' },
  { kind: 'role', label: 'Role' },
  { kind: 'accessProfile', label: 'Access profile' },
  { kind: 'entitlement', label: 'Entitlement' },
  { kind: 'attribute', label: 'Attribute' },
  { kind: 'source', label: 'Source' },
]

/** Review statuses, in the order a reviewer meets them on a card. */
const LEGEND_STATUSES: readonly { status: AccessReviewStatus; label: string }[] = [
  { status: 'needsReview', label: 'Needs Review' },
  { status: 'approved', label: 'Approved' },
  { status: 'revoked', label: 'Revoked' },
  { status: 'reassigned', label: 'Reassigned' },
]

export function GraphLegend() {
  return (
    <div className="vc-graph-legend" role="group" aria-label="Node legend">
      <div className="vc-graph-legend-col">
        <p className="vc-graph-legend-heading">Types</p>
        {LEGEND_KINDS.map(({ kind, label }) => (
          <span className="vc-graph-legend-row" key={kind}>
            <KindIcon kind={kind} className="vc-graph-legend-icon" />
            {label}
          </span>
        ))}
      </div>
      <div className="vc-graph-legend-sep" aria-hidden="true" />
      <div className="vc-graph-legend-col">
        <p className="vc-graph-legend-heading">Status</p>
        {LEGEND_STATUSES.map(({ status, label }) => (
          <span className="vc-graph-legend-row" key={status}>
            <StatusIcon status={status} decorative />
            {label}
          </span>
        ))}
      </div>
      <div className="vc-graph-legend-sep" aria-hidden="true" />
      <div className="vc-graph-legend-col">
        <p className="vc-graph-legend-heading">Flags</p>
        {ACCESS_FLAG_ORDER.map((flag) => (
          <span className="vc-graph-legend-row" key={flag}>
            <FlagIcon flag={flag} />
            {ACCESS_FLAG_LABEL[flag]}
          </span>
        ))}
      </div>
    </div>
  )
}
