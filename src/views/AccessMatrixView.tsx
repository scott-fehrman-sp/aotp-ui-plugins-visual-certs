import { useMemo, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { sortRows } from '../domain/accessMatrixSort'
import type { SortColumn, SortDirection } from '../domain/accessMatrixSort'
import type { AccessMatrixState } from '../state/useAccessMatrix'
import './AccessMatrixView.css'

interface AccessMatrixViewProps {
  campaignName: string
  /** The resolved matrix state (status/rows/graph/…) from useAccessMatrix. */
  matrix: AccessMatrixState
  /** Back to the campaign dashboard. */
  onBack: () => void
}

/** The five sortable columns, in display order, with their header labels. */
const COLUMNS: ReadonlyArray<{ key: SortColumn; label: string }> = [
  { key: 'user', label: 'User' },
  { key: 'role', label: 'Role' },
  { key: 'accessProfile', label: 'Access profile' },
  { key: 'entitlement', label: 'Entitlement' },
  { key: 'source', label: 'Source' },
]

/** The `aria-sort` token for a header: the active direction, else 'none'. */
function ariaSortFor(
  column: SortColumn,
  active: SortColumn,
  direction: SortDirection,
): 'ascending' | 'descending' | 'none' {
  return column === active ? direction : 'none'
}

/**
 * The access expansion matrix screen: a sortable, normalized table of every
 * path from a user down to a leaf entitlement on a source. One row per distinct
 * (user, role, access profile, entitlement, source) path. Blank role/access
 * profile cells mean that level is not on the path. Handles its own
 * loading/empty/error states and a non-fatal banner for soft-degraded rows.
 */
export function AccessMatrixView({
  campaignName,
  matrix,
  onBack,
}: AccessMatrixViewProps) {
  const [column, setColumn] = useState<SortColumn>('user')
  const [direction, setDirection] = useState<SortDirection>('ascending')

  const sorted = useMemo(
    () => sortRows(matrix.rows, column, direction),
    [matrix.rows, column, direction],
  )

  // Clicking the active column flips direction; clicking a new column sorts it
  // ascending.
  const handleSort = (next: SortColumn): void => {
    if (next === column) {
      setDirection((d) => (d === 'ascending' ? 'descending' : 'ascending'))
    } else {
      setColumn(next)
      setDirection('ascending')
    }
  }

  return (
    <section aria-label={`Access map for ${campaignName}`}>
      <button type="button" className="vc-link-btn" onClick={onBack}>
        ← Back to overview
      </button>

      <div className="vc-matrix-head">
        <h2 className="vc-matrix-title">All access paths</h2>
      </div>

      {matrix.status === 'loading' && (
        <LoadingState message="Building the access map…" />
      )}

      {matrix.status === 'error' && (
        <ErrorState
          title="We couldn't build the access map"
          message={
            matrix.error ??
            "Something went wrong while expanding access. Please try again."
          }
          onRetry={matrix.reload}
        />
      )}

      {matrix.status === 'ready' && matrix.rows.length === 0 && (
        <EmptyState
          title="No access to map"
          message="There's no reviewable access to expand into a map for this review."
        />
      )}

      {matrix.status === 'ready' && matrix.rows.length > 0 && (
        <>
          {matrix.unresolvedCount > 0 && (
            <div className="vc-banner" role="status">
              <span>
                {matrix.unresolvedCount}{' '}
                {matrix.unresolvedCount === 1
                  ? 'access path couldn’t'
                  : 'access paths couldn’t'}{' '}
                be fully resolved and{' '}
                {matrix.unresolvedCount === 1 ? 'is' : 'are'} marked Unresolved.
              </span>
            </div>
          )}

          <div className="vc-table-wrap">
            <table className="vc-table vc-matrix-table">
              <caption className="vc-visually-hidden">
                Every path from a user to an entitlement on a source, one row per
                distinct path. A blank role or access profile cell means that
                level is not on the path; blank cells sort first when sorting
                ascending.
              </caption>
              <thead>
                <tr>
                  {COLUMNS.map(({ key, label }) => (
                    <th
                      key={key}
                      scope="col"
                      aria-sort={ariaSortFor(key, column, direction)}
                    >
                      <button
                        type="button"
                        className="vc-matrix-sort"
                        onClick={() => handleSort(key)}
                      >
                        {label}
                        <span className="vc-matrix-sort-ind" aria-hidden="true">
                          {key === column
                            ? direction === 'ascending'
                              ? ' ▲'
                              : ' ▼'
                            : ''}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.id} data-unresolved={row.unresolved || undefined}>
                    <th scope="row">{row.user}</th>
                    <td>
                      <MatrixCell value={row.role} unresolved={row.unresolved} />
                    </td>
                    <td>
                      <MatrixCell
                        value={row.accessProfile}
                        unresolved={row.unresolved}
                      />
                    </td>
                    <td>
                      <MatrixCell
                        value={row.entitlement}
                        unresolved={row.unresolved}
                      />
                    </td>
                    <td>
                      <MatrixCell
                        value={row.source}
                        unresolved={row.unresolved}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

interface MatrixCellProps {
  value: string
  unresolved: boolean
}

/**
 * Renders a matrix cell. A populated value renders as text. A blank value on a
 * resolved row renders visually empty with a visually-hidden "(not applicable)"
 * so screen readers don't read an ambiguous empty cell. A blank value on an
 * unresolved row renders a visible "Unresolved" marker.
 */
function MatrixCell({ value, unresolved }: MatrixCellProps) {
  if (value !== '') return <>{value}</>
  if (unresolved) {
    return <span className="vc-matrix-unresolved">Unresolved</span>
  }
  return <span className="vc-visually-hidden">(not applicable)</span>
}
