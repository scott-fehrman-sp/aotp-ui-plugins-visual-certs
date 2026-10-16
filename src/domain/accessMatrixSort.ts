/**
 * Pure, client-side sorting for the access expansion matrix.
 *
 * The matrix is sortable by any of its five display columns (user, role,
 * accessProfile, entitlement, source). Sorting is a pure transform over the
 * already-canonical row set produced by `resolveMatrix`, so both `compareRows`
 * and `sortRows` are deterministic and never touch the network.
 *
 * Blank-cell rule (design decision, pinned): a blank (`''`) role/accessProfile
 * cell means "that level is not on this path." It is compared as an empty
 * string, so in ASCENDING order blanks sort FIRST (before any populated value)
 * and in DESCENDING order they sort LAST. Comparison is case-insensitive and
 * locale-aware (`localeCompare` with `{ sensitivity: 'base' }`), applied
 * uniformly to every column. When the active column compares equal, a fixed
 * tiebreak chain (user → role → accessProfile → entitlement → source → row id)
 * makes the ordering a total, reproducible order regardless of input order.
 */
import type { AccessMatrixRowVM } from '../sailpoint/types'

/** The five sortable display columns of the matrix. */
export type SortColumn =
  | 'user'
  | 'role'
  | 'accessProfile'
  | 'entitlement'
  | 'source'

/** Sort direction, matching the `aria-sort` token values. */
export type SortDirection = 'ascending' | 'descending'

/** Fixed tiebreak order applied after the active column, for a total order. */
const TIEBREAK_COLUMNS: readonly SortColumn[] = [
  'user',
  'role',
  'accessProfile',
  'entitlement',
  'source',
]

/**
 * Case-insensitive, locale-aware comparison of two display strings. A blank
 * value is an empty string, which sorts before any non-empty value ascending.
 */
function compareValues(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

/**
 * Returns a comparator for the given column + direction. The comparator applies
 * the active column first (negated for descending), then falls through the
 * fixed tiebreak chain (always ascending, so the secondary ordering is stable
 * and does not flip with the primary direction), and finally the row `id`, so
 * two rows never compare equal and the sort is a total order.
 *
 * Pure: the returned comparator reads only its two row arguments.
 */
export function compareRows(
  column: SortColumn,
  direction: SortDirection,
): (a: AccessMatrixRowVM, b: AccessMatrixRowVM) => number {
  const sign = direction === 'descending' ? -1 : 1
  return (a, b) => {
    const primary = compareValues(a[column], b[column])
    if (primary !== 0) return primary * sign

    // Tiebreak chain is always ascending so equal primary keys order stably
    // regardless of the primary direction.
    for (const col of TIEBREAK_COLUMNS) {
      if (col === column) continue
      const cmp = compareValues(a[col], b[col])
      if (cmp !== 0) return cmp
    }
    // Final, guaranteed-unique tiebreak.
    return a.id.localeCompare(b.id)
  }
}

/**
 * Returns a NEW array of the rows sorted by the given column + direction. Never
 * mutates the input array. Invalid/absent arguments default to
 * `user`/`ascending` (defensive; not user-reachable from the view).
 */
export function sortRows(
  rows: AccessMatrixRowVM[],
  column: SortColumn = 'user',
  direction: SortDirection = 'ascending',
): AccessMatrixRowVM[] {
  return [...rows].sort(compareRows(column, direction))
}
