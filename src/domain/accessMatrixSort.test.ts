import { describe, expect, it } from 'vitest'
import type { AccessMatrixRowVM } from '../sailpoint/types'
import { compareRows, sortRows } from './accessMatrixSort'

/**
 * The 6-row worked example (the single golden fixture), as `AccessMatrixRowVM`s.
 * User One holds: Role A (AP foo = {read, write} on engr db + direct ent delete
 * on engr db), AP bar = {read, search} on accounting db, and a direct ent read
 * on phone app.
 */
function workedExample(): AccessMatrixRowVM[] {
  return [
    row({
      id: 'row-foo-read',
      role: 'Role A',
      accessProfile: 'foo',
      entitlement: 'read',
      source: 'engr db',
    }),
    row({
      id: 'row-foo-write',
      role: 'Role A',
      accessProfile: 'foo',
      entitlement: 'write',
      source: 'engr db',
    }),
    row({
      id: 'row-delete',
      role: 'Role A',
      accessProfile: '',
      entitlement: 'delete',
      source: 'engr db',
    }),
    row({
      id: 'row-bar-read',
      role: '',
      accessProfile: 'bar',
      entitlement: 'read',
      source: 'accounting db',
    }),
    row({
      id: 'row-bar-search',
      role: '',
      accessProfile: 'bar',
      entitlement: 'search',
      source: 'accounting db',
    }),
    row({
      id: 'row-phone-read',
      role: '',
      accessProfile: '',
      entitlement: 'read',
      source: 'phone app',
    }),
  ]
}

function row(overrides: Partial<AccessMatrixRowVM>): AccessMatrixRowVM {
  return {
    id: 'r',
    userId: 'u1',
    user: 'User One',
    role: '',
    roleId: null,
    accessProfile: '',
    accessProfileId: null,
    entitlement: '',
    entitlementId: null,
    source: '',
    sourceId: null,
    unresolved: false,
    ...overrides,
  }
}

describe('sortRows', () => {
  it('does not mutate the input array', () => {
    const rows = workedExample()
    const before = rows.map((r) => r.id)
    sortRows(rows, 'entitlement', 'ascending')
    expect(rows.map((r) => r.id)).toEqual(before)
  })

  it('sorts each column ascending and descending as a reverse of each other on distinct keys', () => {
    const rows = workedExample()
    const asc = sortRows(rows, 'source', 'ascending').map((r) => r.source)
    const desc = sortRows(rows, 'source', 'descending').map((r) => r.source)
    // Sources: accounting db (x2), engr db (x3), phone app (x1). Ascending
    // groups accounting first; descending groups phone first.
    expect(asc[0]).toBe('accounting db')
    expect(asc[asc.length - 1]).toBe('phone app')
    expect(desc[0]).toBe('phone app')
    expect(desc[desc.length - 1]).toBe('accounting db')
  })

  it('places blank role cells FIRST ascending and LAST descending', () => {
    const rows = workedExample()
    const asc = sortRows(rows, 'role', 'ascending')
    const desc = sortRows(rows, 'role', 'descending')
    // Three rows have a blank role (bar/read, bar/search, phone/read).
    expect(asc.slice(0, 3).every((r) => r.role === '')).toBe(true)
    expect(desc.slice(-3).every((r) => r.role === '')).toBe(true)
  })

  it('places blank access-profile cells FIRST ascending and LAST descending', () => {
    const rows = workedExample()
    const asc = sortRows(rows, 'accessProfile', 'ascending')
    const desc = sortRows(rows, 'accessProfile', 'descending')
    // Two rows have a blank AP (delete, phone/read).
    expect(asc.slice(0, 2).every((r) => r.accessProfile === '')).toBe(true)
    expect(desc.slice(-2).every((r) => r.accessProfile === '')).toBe(true)
  })

  it('compares case-insensitively (base sensitivity)', () => {
    const rows = [
      row({ id: 'a', accessProfile: 'foo' }),
      row({ id: 'b', accessProfile: 'Foo' }),
    ]
    // 'foo' and 'Foo' are equal under base sensitivity, so the active-column
    // comparator returns 0 and the tiebreak chain decides.
    const cmp = compareRows('accessProfile', 'ascending')
    expect(cmp(rows[0], rows[1])).toBe(rows[0].id.localeCompare(rows[1].id))
  })

  it('is a total, deterministic order on equal keys regardless of input order', () => {
    // All rows share the same user key; the tiebreak chain must impose a stable
    // total order independent of starting order.
    const a = workedExample()
    const b = [...a].reverse()
    const sortedA = sortRows(a, 'user', 'ascending').map((r) => r.id)
    const sortedB = sortRows(b, 'user', 'ascending').map((r) => r.id)
    expect(sortedA).toEqual(sortedB)
  })

  it('falls through the tiebreak chain then the row id for a guaranteed order', () => {
    const r1 = row({ id: 'z', role: 'Role A', accessProfile: 'foo', entitlement: 'read', source: 'engr db' })
    const r2 = row({ id: 'a', role: 'Role A', accessProfile: 'foo', entitlement: 'read', source: 'engr db' })
    // Identical in every sortable column -> only the id breaks the tie.
    const sorted = sortRows([r1, r2], 'user', 'ascending')
    expect(sorted.map((r) => r.id)).toEqual(['a', 'z'])
  })
})
