/**
 * Identity lookup for the "reassign" flow. A reviewer who wants to hand an item
 * to someone else needs to find that person by name or email, so this wraps the
 * ISC Search API (identities index) and maps raw rows into the clean
 * {@link IdentityOption} the recipient picker renders. Errors become
 * {@link FriendlyError}s, exactly like the certification wrappers.
 *
 * The query building and defensive row mapping mirror the pattern used by the
 * sibling org-graph plugin, trimmed to the three fields this picker shows.
 */
import { Index, SearchApi } from 'sailpoint-api-client/search/api'
import { FriendlyError, toFriendlyError } from './certifications'
import type { IdentityOption } from './types'

// Re-export so callers that already depend on this module can surface the
// friendly error type without reaching back into certifications.ts.
export { FriendlyError }

/** The identity fields a free-text term can match against. */
const SEARCH_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'emailAddress',
  'attributes.firstname',
  'attributes.lastname',
  'attributes.email',
]

/** How many matches to show; the picker is a short, scannable list. */
const SEARCH_LIMIT = 25

/**
 * Escapes the characters the search engine treats as query operators so a term
 * like "o'brien" or "a+b" is matched literally rather than parsed as syntax.
 */
function escapeSearchTerm(value: string): string {
  return value.replace(/[+\-=&|><!(){}[\]^"~*?:\\/]/g, '\\$&')
}

/**
 * Builds a "contains" query where every whitespace-separated term must appear
 * somewhere in a name or email field. Each term becomes an OR across the fields
 * and the terms are joined by AND, so "jane doe" matches a person whose name
 * spans two fields.
 */
export function buildIdentityQuery(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeSearchTerm)
    .map(
      (term) =>
        `(${SEARCH_FIELDS.map((field) => `${field}:*${term}*`).join(' OR ')})`,
    )
    .join(' AND ')
}

// --- small untyped-access helpers (search rows are untyped objects) ---------
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
/** Reads the first non-empty string among the given keys, trimmed. */
function firstString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** Maps one untyped search row into an IdentityOption, or null if it has no id. */
function toIdentityOption(row: unknown): IdentityOption | null {
  if (!isRecord(row)) return null
  const id = firstString(row, ['id'])
  if (!id) return null
  const attributes = isRecord(row.attributes) ? row.attributes : {}
  // Display name and email can live at the top level or under attributes
  // depending on how the identity was indexed, so check both defensively.
  const displayName =
    firstString(row, ['displayName', 'name']) ||
    firstString(attributes, ['displayName', 'name'])
  const email =
    firstString(row, ['email', 'emailAddress']) ||
    firstString(attributes, ['email', 'emailAddress'])
  return { id, displayName, email }
}

/**
 * Searches identities by name or email. Returns an empty list for input shorter
 * than two non-space characters so a single keystroke never fires a query.
 */
export async function searchIdentities(
  api: SearchApi,
  rawQuery: string,
): Promise<IdentityOption[]> {
  if (rawQuery.replace(/\s/g, '').length < 2) return []
  const query = buildIdentityQuery(rawQuery)
  if (!query) return []
  try {
    const res = await api.searchPostV1({
      search: {
        indices: [Index.Identities],
        query: { query },
        sort: ['name'],
      },
      limit: SEARCH_LIMIT,
      count: false,
    })
    const rows = res.data ?? []
    const options: IdentityOption[] = []
    for (const row of rows) {
      const option = toIdentityOption(row)
      if (option) options.push(option)
    }
    return options
  } catch (error) {
    throw toFriendlyError(error)
  }
}
