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
import { IdentitiesApi } from 'sailpoint-api-client/identities/api'
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
 * Identity attribute keys probed for the user node's department / location.
 * Tenants map these attributes under different names, so each is read
 * defensively with {@link firstString} (first non-empty wins, default ''):
 *   - department: 'department', 'departmentName', 'dept'
 *   - location:   'location', 'city', 'region', 'locality', 'workLocation'
 */
const DEPARTMENT_KEYS = ['department', 'departmentName', 'dept']
const LOCATION_KEYS = ['location', 'city', 'region', 'locality', 'workLocation']
const COUNTRY_KEYS = ['country', 'countryName', 'countryCode']

/**
 * The richer per-identity detail the user node's detail panel shows. Mirrors
 * the set the sibling org-graph plugin surfaces (email, title, phone, manager,
 * lifecycle / identity state, isManager, identity id) plus the existing
 * department / location. Every field is a plain display string so the panel
 * renders it directly; '' means "unknown / not set".
 */
export interface ResolvedIdentity {
  department: string
  location: string
  country: string
  email: string
  title: string
  phone: string
  /** 'Yes' / 'No' / '' — whether the identity manages others. */
  isManager: string
  /** Manager's display name, from `managerRef.name`. */
  manager: string
  /** Lifecycle state name, from `lifecycleState.stateName`. */
  lifecycleState: string
  /** Identity status, from `identityStatus`. */
  identityState: string
  /** The identity's own id. */
  identityId: string
}

/**
 * A {@link ResolvedIdentity} with every field blank, optionally overridden.
 * Used as the soft-degrade fallback and as a convenient base for test stubs
 * that only care about a field or two.
 */
export function emptyResolvedIdentity(
  overrides: Partial<ResolvedIdentity> = {},
): ResolvedIdentity {
  return {
    department: '',
    location: '',
    country: '',
    email: '',
    title: '',
    phone: '',
    isManager: '',
    manager: '',
    lifecycleState: '',
    identityState: '',
    identityId: '',
    ...overrides,
  }
}

/** Title lives under `attributes` and is tenant-mapped; probe a few key names. */
const TITLE_KEYS = ['title', 'jobTitle', 'jobtitle']
/** Phone likewise lives under `attributes` across several tenant key names. */
const PHONE_KEYS = [
  'phone',
  'workPhone',
  'workphone',
  'telephone',
  'telephoneNumber',
  'telephonenumber',
  'phoneNumber',
  'phonenumber',
  'mobilePhone',
  'mobilephone',
  'mobile',
]

/**
 * Looks up ONE identity's full detail for the access-graph user detail panel
 * via `IdentitiesApi.getIdentityV1`, which returns the authoritative identity
 * object (email, isManager, managerRef, lifecycleState, attributes). Enrichment
 * only: an empty id or ANY error soft-degrades to {@link EMPTY_IDENTITY} and
 * never throws, so a failed lookup can never blank a matrix row.
 *
 * Title and phone are not first-class on the Identity object, so they are read
 * defensively from `attributes` (tenant-mapped key names), mirroring how
 * department / location are probed in {@link fetchIdentityAttributes}.
 * Department / location are read from `attributes` too so this single call
 * supersedes the Search-index lookup for a user who has a full identity record.
 */
export async function fetchIdentityDetail(
  api: IdentitiesApi,
  identityId: string,
): Promise<ResolvedIdentity> {
  if (!identityId) return emptyResolvedIdentity()
  try {
    const res = await api.getIdentityV1({ id: identityId })
    const identity = (isRecord(res.data) ? res.data : {}) as Record<string, unknown>
    const attributes = isRecord(identity.attributes)
      ? (identity.attributes as Record<string, unknown>)
      : {}
    const managerRef = isRecord(identity.managerRef)
      ? (identity.managerRef as Record<string, unknown>)
      : {}
    const lifecycle = isRecord(identity.lifecycleState)
      ? (identity.lifecycleState as Record<string, unknown>)
      : {}
    const email =
      firstString(identity, ['emailAddress', 'email']) ||
      firstString(attributes, ['email', 'emailAddress'])
    const department =
      firstString(attributes, DEPARTMENT_KEYS) || firstString(identity, DEPARTMENT_KEYS)
    const location =
      firstString(attributes, LOCATION_KEYS) || firstString(identity, LOCATION_KEYS)
    const country =
      firstString(attributes, COUNTRY_KEYS) || firstString(identity, COUNTRY_KEYS)
    const title = firstString(attributes, TITLE_KEYS)
    const phone = firstString(attributes, PHONE_KEYS)
    const manager = firstString(managerRef, ['name'])
    const lifecycleState = firstString(lifecycle, ['stateName'])
    const identityState = firstString(identity, ['identityStatus'])
    const isManager =
      identity.isManager === true ? 'Yes' : identity.isManager === false ? 'No' : ''
    return {
      department,
      location,
      country,
      email,
      title,
      phone,
      isManager,
      manager,
      lifecycleState,
      identityState,
      identityId: firstString(identity, ['id']) || identityId,
    }
  } catch {
    // Soft-degrade: a failed identity fetch must never blank a matrix row.
    return emptyResolvedIdentity()
  }
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
