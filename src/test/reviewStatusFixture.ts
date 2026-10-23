/**
 * Shared fixture for the review-status graph tests: review items for two users
 * plus a canned composition resolver, wired through the REAL pipeline
 * (`resolveMatrix` -> `deriveAccessGraph` -> `applyReviewStatus`).
 *
 * Composition:
 *   AP ap-bill   = { e-pay }
 *   AP ap-foo    = { e-read, e-write }
 *   role-a       = { AP ap-foo, direct entitlement e-del }
 *   ap-empty     = {} (zero entitlements)     role-empty = {} (nothing at all)
 *   role-blank   = { e-pay } but with a blank resolved name
 *
 * User A (u-a) holds, at the FIRST level: ap-bill (needsReview), role-a
 * (reassigned), e-login (approved), e-admin (revoked), e-read (approved). e-read
 * is also reachable nested under role-a -> ap-foo.
 * User B (u-b) holds e-login (needsReview) and ap-bill (reassigned).
 */
import { deriveAccessGraph } from '../domain/accessGraph'
import { applyReviewStatus } from '../domain/reviewOverlay'
import { resolveMatrix } from '../sailpoint/accessMatrix'
import type {
  AccessCompositionResolver,
  ResolvedAccessProfile,
  ResolvedEntitlement,
  ResolvedRole,
  ResolvedSource,
} from '../sailpoint/accessMatrix'
import { emptyResolvedIdentity } from '../sailpoint/identities'
import { userSubgraph } from '../graph/userSubgraph'
import type {
  AccessGraphData,
  AccessMatrixRowVM,
  AccessReviewStatus,
  ReviewItemVM,
} from '../sailpoint/types'

export function reviewItem(overrides: Partial<ReviewItemVM>): ReviewItemVM {
  return {
    id: 'r1',
    identityId: 'u-a',
    completed: false,
    decision: null,
    reassigned: false,
    comments: null,
    personName: 'Alice Adams',
    accessName: 'access',
    accessKind: 'access',
    accessId: null,
    accessDescription: null,
    sourceName: null,
    isNewAccess: false,
    isPrivileged: false,
    isCloudGoverned: false,
    dataImpact: null,
    usageDays: null,
    aiRecommendation: null,
    revocable: true,
    ...overrides,
  }
}

const A = { identityId: 'u-a', personName: 'Alice Adams' }
const B = { identityId: 'u-b', personName: 'Bob Brown' }

/** Review items for users A and B (see the file header). */
export function fixtureItems(): ReviewItemVM[] {
  return [
    reviewItem({ ...A, id: 'a-ap-bill', accessKind: 'accessProfile', accessId: 'ap-bill', accessName: 'Billing' }),
    reviewItem({ ...A, id: 'a-role', accessKind: 'role', accessId: 'role-a', accessName: 'Role A', reassigned: true }),
    reviewItem({ ...A, id: 'a-login', accessKind: 'entitlement', accessId: 'e-login', accessName: 'Login', completed: true, decision: 'APPROVE' }),
    reviewItem({ ...A, id: 'a-admin', accessKind: 'entitlement', accessId: 'e-admin', accessName: 'Admin', completed: true, decision: 'REVOKE' }),
    reviewItem({ ...A, id: 'a-read', accessKind: 'entitlement', accessId: 'e-read', accessName: 'Read', completed: true, decision: 'APPROVE' }),
    reviewItem({ ...B, id: 'b-login', accessKind: 'entitlement', accessId: 'e-login', accessName: 'Login' }),
    reviewItem({ ...B, id: 'b-ap-bill', accessKind: 'accessProfile', accessId: 'ap-bill', accessName: 'Billing', reassigned: true }),
  ]
}

function ent(
  id: string,
  name: string,
  sourceId: string,
  sourceName: string,
): ResolvedEntitlement {
  return {
    id,
    name,
    description: `${name} description`,
    sourceId,
    sourceName,
    sourceDescription: `${sourceName} description`,
    attribute: 'memberOf',
    value: `cn=${name}`,
    objectType: 'group',
    privileged: false,
    cloudGoverned: false,
    requestable: true,
    owner: `${name} owner`,
    tags: '',
    created: '',
    modified: '',
    attributes: [],
    source: null,
  }
}

// Fills a source's extra attribute fields with inert defaults.
function mkSrc(
  s: Pick<ResolvedSource, 'id' | 'name' | 'description'>,
): ResolvedSource {
  return {
    owner: `${s.name || 'source'} owner`,
    type: 'Delimited File',
    connector: 'delimited-file',
    connectionType: 'file',
    category: '',
    cluster: '',
    authoritative: false,
    healthy: true,
    status: 'SOURCE_STATE_HEALTHY',
    created: '',
    modified: '',
    ...s,
  }
}

// Fills a role's extra attribute fields with inert defaults so each fixture
// literal stays focused on id/name/description/refs.
function mkRole(
  r: Pick<
    ResolvedRole,
    'id' | 'name' | 'description' | 'accessProfileRefs' | 'entitlementRefs'
  >,
): ResolvedRole {
  return {
    owner: `${r.name || 'role'} owner`,
    enabled: true,
    requestable: true,
    privilegeLevel: '',
    dimensional: false,
    created: '',
    modified: '',
    ...r,
  }
}

// Fills an access profile's extra attribute fields with inert defaults.
function mkAp(
  a: Pick<
    ResolvedAccessProfile,
    'id' | 'name' | 'description' | 'entitlementRefs'
  >,
): ResolvedAccessProfile {
  return {
    sourceName: `${a.name || 'ap'} source`,
    owner: `${a.name || 'ap'} owner`,
    enabled: true,
    requestable: true,
    created: '',
    modified: '',
    ...a,
  }
}

/** A canned, network-free composition resolver for the fixture. */
export function fixtureResolver(): AccessCompositionResolver {
  const roles: Record<string, ResolvedRole> = {
    'role-a': mkRole({
      id: 'role-a',
      name: 'Role A',
      description: 'Role A description',
      accessProfileRefs: [{ id: 'ap-foo', name: 'Foo' }],
      entitlementRefs: [{ id: 'e-del', name: 'Delete' }],
    }),
    'role-empty': mkRole({
      id: 'role-empty',
      name: 'Empty Role',
      description: '',
      accessProfileRefs: [],
      entitlementRefs: [],
    }),
    'role-blank': mkRole({
      id: 'role-blank',
      name: '',
      description: '',
      accessProfileRefs: [],
      entitlementRefs: [{ id: 'e-pay', name: 'Pay' }],
    }),
  }
  const aps: Record<string, ResolvedAccessProfile> = {
    'ap-bill': mkAp({
      id: 'ap-bill',
      name: 'Billing',
      description: 'Billing description',
      entitlementRefs: [{ id: 'e-pay', name: 'Pay' }],
    }),
    'ap-foo': mkAp({
      id: 'ap-foo',
      name: 'Foo',
      description: 'Foo description',
      entitlementRefs: [
        { id: 'e-read', name: 'Read' },
        { id: 'e-write', name: 'Write' },
      ],
    }),
    'ap-empty': mkAp({
      id: 'ap-empty',
      name: 'Empty AP',
      description: '',
      entitlementRefs: [],
    }),
  }
  const ents: Record<string, ResolvedEntitlement> = {
    'e-pay': ent('e-pay', 'Pay', 's-erp', 'ERP'),
    'e-read': ent('e-read', 'Read', 's-erp', 'ERP'),
    'e-write': ent('e-write', 'Write', 's-erp', 'ERP'),
    'e-del': ent('e-del', 'Delete', 's-erp', 'ERP'),
    'e-login': ent('e-login', 'Login', 's-dir', 'Directory'),
    'e-admin': ent('e-admin', 'Admin', 's-dir', 'Directory'),
  }
  const sources: Record<string, ResolvedSource> = {
    's-erp': mkSrc({ id: 's-erp', name: 'ERP', description: 'ERP description' }),
    's-dir': mkSrc({ id: 's-dir', name: 'Directory', description: 'Directory description' }),
  }
  // Name -> resolved entitlement, for the id-less fallback lookup.
  const entsByName: Record<string, ResolvedEntitlement> = {}
  for (const e of Object.values(ents)) entsByName[e.name] = e
  return {
    role: (id) => Promise.resolve(roles[id] ?? null),
    accessProfile: (id) => Promise.resolve(aps[id] ?? null),
    entitlement: (id) => Promise.resolve(ents[id] ?? null),
    entitlementByName: (name) => Promise.resolve(entsByName[name] ?? null),
    source: (id) => Promise.resolve(sources[id] ?? null),
    identity: () =>
      Promise.resolve(
        emptyResolvedIdentity({
          department: 'Finance',
          location: 'Austin',
          country: 'USA',
          email: 'alice.adams@example.com',
          title: 'Staff Engineer',
          phone: '+1 555 0100',
          isManager: 'Yes',
          manager: 'Carol Chen',
          lifecycleState: 'active',
          identityState: 'ACTIVE',
          identityId: 'u-a',
        }),
      ),
  }
}

/** Runs the real pipeline: items -> rows -> structural graph -> live overlay. */
export async function buildFixtureGraph(
  items: ReviewItemVM[] = fixtureItems(),
): Promise<AccessGraphData> {
  const rows = await resolveMatrix(items, fixtureResolver())
  return applyReviewStatus(deriveAccessGraph(rows), items)
}

/** A matrix row plus the review status its review item should carry (test sugar). */
export type StatusRow = AccessMatrixRowVM & { reviewStatus?: AccessReviewStatus }

const STATUS_FIELDS: Record<AccessReviewStatus, Partial<ReviewItemVM>> = {
  needsReview: {},
  approved: { completed: true, decision: 'APPROVE' },
  revoked: { completed: true, decision: 'REVOKE' },
  reassigned: { reassigned: true },
}

/**
 * Builds a graph from hand-written rows through the real overlay: the review
 * items are synthesized from each row that has `reviewStatus` + an access-item
 * identity, then applied with `applyReviewStatus`. Lets graph/scene tests state
 * a first-level status without hand-building review items.
 */
export function statusGraph(rows: StatusRow[]): AccessGraphData {
  const items = rows.flatMap((r) =>
    r.reviewStatus && r.accessItemKind
      ? [
          reviewItem({
            id: `item-${r.id}`,
            identityId: r.userId,
            personName: r.user,
            accessKind: r.accessItemKind as ReviewItemVM['accessKind'],
            accessId: r.accessItemId ?? null,
            accessName: r.accessItemName ?? '',
            ...STATUS_FIELDS[r.reviewStatus],
          }),
        ]
      : [],
  )
  return applyReviewStatus(deriveAccessGraph(rows), items)
}

/** {@link statusGraph} narrowed to one user's drill-down subgraph. */
export function statusSubgraph(
  rows: StatusRow[],
  userNodeId = 'user:u1',
): AccessGraphData {
  return userSubgraph(statusGraph(rows), userNodeId)
}
