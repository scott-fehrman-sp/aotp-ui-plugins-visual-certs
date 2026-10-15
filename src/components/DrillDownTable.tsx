import { ACCESS_KIND_LABEL } from '../domain/language'
import type { PrioritizedItem } from '../domain/priority'
import './DrillDownTable.css'

interface DrillDownTableProps {
  ordered: PrioritizedItem[]
}

const PRIORITY_LABEL: Record<string, string> = {
  high: 'Needs a close look',
  medium: 'Worth checking',
  low: 'Lower concern',
  none: 'Routine',
}

/**
 * A SECONDARY, tabular view of the same items for users who want to scan
 * everything at once. This is intentionally not the primary experience (the
 * visual queue is) — it's a drill-down for detail.
 */
export function DrillDownTable({ ordered }: DrillDownTableProps) {
  if (ordered.length === 0) {
    return <p className="vc-table-empty">There's nothing to show here.</p>
  }

  return (
    <div className="vc-table-wrap">
      <table className="vc-table">
        <caption className="vc-visually-hidden">
          All access items in this review, in priority order
        </caption>
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Access</th>
            <th scope="col">Type</th>
            <th scope="col">Priority</th>
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map(({ item, priority }) => (
            <tr key={item.id}>
              <td>{item.personName}</td>
              <td>
                {item.accessName}
                {item.sourceName && (
                  <span className="vc-table-source"> ({item.sourceName})</span>
                )}
              </td>
              <td>{ACCESS_KIND_LABEL[item.accessKind]}</td>
              <td>
                <span className="vc-table-pri" data-priority={priority.level}>
                  {PRIORITY_LABEL[priority.level]}
                </span>
              </td>
              <td>
                {item.reassigned
                  ? 'Reassigned'
                  : item.decision === 'APPROVE'
                    ? 'Kept'
                    : item.decision === 'REVOKE'
                      ? 'Removed'
                      : 'Not decided'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
