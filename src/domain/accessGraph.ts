/**
 * Pure derivation of a node/edge graph from the access expansion matrix.
 *
 * `deriveAccessGraph` turns the canonical matrix rows into `{ nodes, edges }`
 * suitable for a future bidirectional (users ↔ sources) graph renderer. It is a
 * lossless, deterministic transform of the rows — no I/O, no input mutation.
 */
import type {
  AccessGraphData,
  AccessGraphEdge,
  AccessGraphNode,
  AccessGraphNodeKind,
  AccessMatrixRowVM,
  NodeDetail,
} from '../sailpoint/types'
import { withAttributeEntitlementCounts } from './attributeEntitlementCounts'
import { reviewKey } from './reviewOverlay'

/**
 * The user node's display label: "FIRST LAST" built from the resolved
 * first / last name. Falls back to whichever name part is present, and finally
 * to the API display name (`row.user`) when neither was resolved, so a user
 * node always has a non-empty label even if the identity lookup soft-degraded.
 */
function userLabel(row: AccessMatrixRowVM): string {
  const first = (row.userFirstName ?? '').trim()
  const last = (row.userLastName ?? '').trim()
  const combined = [first, last].filter(Boolean).join(' ')
  return combined || row.user
}

/** One present level on a row's path: a graph node to add + edge to continue. */
interface Level {
  id: string
  kind: AccessGraphNodeKind
  label: string
  /** Extra detail for this node (user identity fields, or a description). */
  detail?: NodeDetail
}

/**
 * Builds a node's `detail` from the row, keeping only non-empty keys. Returns
 * `undefined` when there is nothing to show so a bare node stays
 * `{ id, kind, label }` (and the detail panel renders only kind + label). For a
 * user node the identity fields; an entitlement node its full attribute set;
 * every other kind the item's description.
 */
function detailFor(
  kind: AccessGraphNodeKind,
  row: AccessMatrixRowVM,
): Level['detail'] {
  const detail: NodeDetail = {}
  if (kind === 'user') {
    // First / last name are carried for the grid's last-name sort (not shown by
    // the detail panel's fixed field list).
    if (row.userFirstName) detail.firstName = row.userFirstName
    if (row.userLastName) detail.lastName = row.userLastName
    if (row.userDepartment) detail.department = row.userDepartment
    if (row.userLocation) detail.location = row.userLocation
    if (row.userCountry) detail.country = row.userCountry
    if (row.userEmail) detail.email = row.userEmail
    if (row.userTitle) detail.title = row.userTitle
    if (row.userPhone) detail.phone = row.userPhone
    if (row.userIsManager) detail.isManager = row.userIsManager
    if (row.userManager) detail.manager = row.userManager
    if (row.userLifecycleState) detail.lifecycleState = row.userLifecycleState
    if (row.userIdentityState) detail.identityState = row.userIdentityState
    if (row.userIdentityId) detail.identityId = row.userIdentityId
  } else if (kind === 'entitlement') {
    // The full attribute set for an entitlement leaf. Boolean flags only land
    // when true (shown as 'Yes'); everything else only when non-empty, so a
    // sparse entitlement still collapses to just name + whatever it has.
    if (row.entitlementDescription) detail.description = row.entitlementDescription
    if (row.source) detail.source = row.source
    if (row.entitlementAttribute) detail.attribute = row.entitlementAttribute
    if (row.entitlementValue) detail.value = row.entitlementValue
    if (row.entitlementObjectType) detail.objectType = row.entitlementObjectType
    if (row.entitlementPrivileged) detail.privileged = 'Yes'
    if (row.entitlementCloudGoverned) detail.cloudGoverned = 'Yes'
    if (row.entitlementRequestable) detail.requestable = 'Yes'
    if (row.entitlementOwner) detail.owner = row.entitlementOwner
    if (row.entitlementTags) detail.tags = row.entitlementTags
    if (row.entitlementCreated) detail.created = row.entitlementCreated
    if (row.entitlementModified) detail.modified = row.entitlementModified
    if (row.entitlementId) detail.entitlementId = row.entitlementId
    // The free-form source attributes ("Additional attributes"); only attach a
    // non-empty list so a sparse entitlement keeps no empty section.
    if (row.entitlementAttributes && row.entitlementAttributes.length > 0) {
      detail.attributes = row.entitlementAttributes
    }
  } else if (kind === 'role') {
    // The full attribute set for a role. Boolean flags only land when true
    // (shown as 'Yes'); everything else only when non-empty.
    if (row.roleDescription) detail.description = row.roleDescription
    if (row.roleOwner) detail.owner = row.roleOwner
    if (row.roleEnabled) detail.enabled = 'Yes'
    if (row.roleRequestable) detail.requestable = 'Yes'
    if (row.rolePrivilegeLevel) detail.privilegeLevel = row.rolePrivilegeLevel
    if (row.roleDimensional) detail.dimensional = 'Yes'
    if (row.roleCreated) detail.created = row.roleCreated
    if (row.roleModified) detail.modified = row.roleModified
    if (row.roleId) detail.roleId = row.roleId
  } else if (kind === 'attribute') {
    // The source this attribute belongs to. The entitlement count is stamped
    // after every edge exists, so it reflects distinct entitlements, not the
    // first row that introduced the node.
    if (row.source) detail.source = row.source
    if (row.sourceId) detail.sourceId = row.sourceId
  } else if (kind === 'accessProfile') {
    // The full attribute set for an access profile.
    if (row.accessProfileDescription) {
      detail.description = row.accessProfileDescription
    }
    if (row.accessProfileSource) detail.source = row.accessProfileSource
    if (row.accessProfileOwner) detail.owner = row.accessProfileOwner
    if (row.accessProfileEnabled) detail.enabled = 'Yes'
    if (row.accessProfileRequestable) detail.requestable = 'Yes'
    if (row.accessProfileCreated) detail.created = row.accessProfileCreated
    if (row.accessProfileModified) detail.modified = row.accessProfileModified
    if (row.accessProfileId) detail.accessProfileId = row.accessProfileId
  } else {
    // Source node: its full attribute set. Boolean flags only land when true
    // (shown as 'Yes'); everything else only when non-empty.
    if (row.sourceDescription) detail.description = row.sourceDescription
    if (row.sourceType) detail.type = row.sourceType
    if (row.sourceConnector) detail.connector = row.sourceConnector
    if (row.sourceConnectionType) detail.connectionType = row.sourceConnectionType
    if (row.sourceCategory) detail.category = row.sourceCategory
    if (row.sourceOwner) detail.owner = row.sourceOwner
    if (row.sourceCluster) detail.cluster = row.sourceCluster
    if (row.sourceAuthoritative) detail.authoritative = 'Yes'
    if (row.sourceHealthy) detail.healthy = 'Yes'
    if (row.sourceStatus) detail.status = row.sourceStatus
    if (row.sourceCreated) detail.created = row.sourceCreated
    if (row.sourceModified) detail.modified = row.sourceModified
    if (row.sourceId) detail.sourceId = row.sourceId
  }
  return Object.keys(detail).length > 0 ? detail : undefined
}

/** Human-readable kind names for the blank-label fallback of a first-level item. */
const KIND_LABEL: Record<AccessGraphNodeKind, string> = {
  user: 'user',
  role: 'role',
  accessProfile: 'access profile',
  entitlement: 'entitlement',
  attribute: 'attribute',
  source: 'source',
}

/**
 * Builds the namespaced id for a level. When the real id is known we use
 * `<kind>:<id>`; when it is null (an unresolved leaf or a role/AP that could
 * not be deep-fetched) we fall back to a name-based synthetic id so the row
 * still contributes a stable node. The entitlement fallback additionally folds
 * in the source so two same-named entitlements on different sources never
 * collapse into one node even without ids.
 */
function entitlementFallbackId(row: AccessMatrixRowVM): string {
  const sourceKey = row.sourceId ?? row.source
  return `entitlement:name:${sourceKey}:${row.entitlement}`
}

/**
 * Derives a deduped node/edge graph from the access matrix rows. PURE: no I/O,
 * no mutation of inputs, deterministic output order (insertion order over the
 * given rows). Direction is
 *   user → (role?) → (accessProfile?) → entitlement → (attribute?) → source
 * with absent (blank) levels SKIPPED so the chain always connects consecutive
 * present levels. An entitlement that carries a schema attribute
 * (`entitlementAttribute`) inserts an ATTRIBUTE node for that attribute on
 * its source, and the entitlement links to the attribute instead of the
 * source. Entitlements with no attribute still link straight to the source:
 *   - direct entitlement:        user → entitlement → source
 *   - with an attribute:         user → entitlement → attribute → source
 *   - AP grant:                  user → accessProfile → entitlement → source
 *   - role direct entitlement:   user → role → entitlement → source
 *   - role → AP → entitlement:   user → role → accessProfile → entitlement → source
 *
 * First level: the user's directly-held access item (the role / access profile /
 * entitlement under review, `row.accessItemKind`) is ALWAYS the first hop off the
 * user, even when its resolved label is blank (the label then falls back to the
 * review item's own name, then `Unnamed <kind>`), so a deeper node can never
 * replace it. That user→item edge is marked `firstLevel` with a `reviewKey`;
 * every deeper edge is reference-only and carries neither. Review STATUS is not
 * derived here: it is a live per-user overlay (`applyReviewStatus`), and node
 * status is derived from the edge by `userSubgraph`. Nodes here never carry a
 * status because they are shared across users.
 *
 * Node id scheme (namespaced so ids never collide across layers):
 *   - `user:<userId>`
 *   - `role:<roleId>`                 (fallback `role:name:<roleName>`)
 *   - `accessProfile:<accessProfileId>` (fallback `accessProfile:name:<apName>`)
 *   - `entitlement:<entitlementId>`   (fallback
 *     `entitlement:name:<sourceId|sourceName>:<entName>` — keeps same-named
 *     entitlements on different sources distinct even without ids)
 *   - `attribute:<sourceKey>:<name>`  one node per attribute name on a source
 *     (`sourceKey` is the source id, or `name:<sourceName>` when it has none)
 *   - `source:<sourceId>`             (fallback `source:name:<sourceName>`)
 *
 * Nodes dedupe by namespaced id (first label wins). Edges dedupe by
 * `from|to` and accumulate `pathCount` (how many rows traverse the edge). A
 * single-level path (only the user present) contributes no edge.
 *
 * Bidirectional-ready: reverse traversal (sources → users) is supported by
 * walking the stored edges on `to`; no reverse edges are stored, so the graph
 * stays minimal while a future renderer can start from either end.
 *
 * All-blank-leaf case: a degenerate `access`-kind row (user populated;
 * role/accessProfile/entitlement/source all blank, their ids all null)
 * contributes ONLY the `user` node and NO edges — there is no leaf to anchor a
 * path, so no entitlement/source node is synthesized. For every other kind,
 * entitlement and source are conceptually present and always yield nodes, with
 * their ids possibly synthetic on a fetch-failure `unresolved` row.
 */
export function deriveAccessGraph(
  rows: AccessMatrixRowVM[],
): AccessGraphData {
  const nodes = new Map<string, AccessGraphNode>()
  const edges = new Map<string, AccessGraphEdge>()

  const addNode = (level: Level): void => {
    if (!nodes.has(level.id)) {
      // First-wins: the first row to introduce a node id sets its label AND
      // detail; later rows for the same node do not overwrite.
      const node: AccessGraphNode = {
        id: level.id,
        kind: level.kind,
        label: level.label,
      }
      if (level.detail) node.detail = level.detail
      nodes.set(level.id, node)
    }
  }

  for (const row of rows) {
    const levels: Level[] = []

    // User is always present.
    levels.push({
      id: `user:${row.userId}`,
      kind: 'user',
      label: userLabel(row),
      detail: detailFor('user', row),
    })

    // Role / access profile / entitlement are present when on this path (blank =
    // skipped) OR when they are the user's directly-held item (`heldKind`), in
    // which case a blank label falls back so the first hop is never lost.
    const heldKind = row.accessItemKind
    const heldLabel = (kind: AccessGraphNodeKind, label: string): string =>
      label !== '' ? label : row.accessItemName || `Unnamed ${KIND_LABEL[kind]}`

    if (row.role !== '' || heldKind === 'role') {
      const label = heldLabel('role', row.role)
      levels.push({
        id: row.roleId
          ? `role:${row.roleId}`
          : row.accessItemId && heldKind === 'role' && row.role === ''
            ? `role:${row.accessItemId}`
            : `role:name:${label}`,
        kind: 'role',
        label,
        detail: detailFor('role', row),
      })
    }
    if (row.accessProfile !== '' || heldKind === 'accessProfile') {
      const label = heldLabel('accessProfile', row.accessProfile)
      levels.push({
        id: row.accessProfileId
          ? `accessProfile:${row.accessProfileId}`
          : row.accessItemId && heldKind === 'accessProfile' && row.accessProfile === ''
            ? `accessProfile:${row.accessItemId}`
            : `accessProfile:name:${label}`,
        kind: 'accessProfile',
        label,
        detail: detailFor('accessProfile', row),
      })
    }

    // Entitlement + source are present on every real leaf row. They are blank
    // together on the degenerate `access`-kind row (just the user node) and on a
    // bare first-level row for an empty access profile / role (user → item only).
    if (row.entitlement !== '' || heldKind === 'entitlement') {
      levels.push({
        id: row.entitlementId
          ? `entitlement:${row.entitlementId}`
          : entitlementFallbackId(row),
        kind: 'entitlement',
        label: heldLabel('entitlement', row.entitlement),
        detail: detailFor('entitlement', row),
      })
    }
    // A schema attribute on this entitlement becomes its own node, shared by
    // every entitlement that uses the same attribute on the same source. The
    // entitlement then links to the attribute, and the attribute links once
    // to the source (edge dedupe), instead of the entitlement linking to the
    // source directly. No attribute, or no source to attach it to, leaves the
    // entitlement → source hop as it was.
    const attributeName = (row.entitlementAttribute ?? '').trim()
    if (
      levels[levels.length - 1]?.kind === 'entitlement' &&
      attributeName !== '' &&
      row.source !== ''
    ) {
      const sourceKey = row.sourceId ? row.sourceId : `name:${row.source}`
      levels.push({
        id: `attribute:${sourceKey}:${attributeName}`,
        kind: 'attribute',
        label: attributeName,
        detail: detailFor('attribute', row),
      })
    }
    if (row.source !== '') {
      levels.push({
        id: row.sourceId ? `source:${row.sourceId}` : `source:name:${row.source}`,
        kind: 'source',
        label: row.source,
        detail: detailFor('source', row),
      })
    }

    // Add nodes, then one edge per consecutive present pair. The user→first-hop
    // edge is the review hop only when the first hop IS the held item's kind
    // (a degenerate `access` row has no held kind, so it marks nothing).
    for (const level of levels) addNode(level)
    const firstHop = levels[1]
    const markFirstLevel =
      firstHop !== undefined &&
      heldKind !== undefined &&
      firstHop.kind === heldKind
    for (let i = 0; i < levels.length - 1; i++) {
      const from = levels[i].id
      const to = levels[i + 1].id
      const key = `${from}|${to}`
      let edge = edges.get(key)
      if (edge) {
        edge.pathCount += 1
      } else {
        edge = { from, to, pathCount: 1 }
        edges.set(key, edge)
      }
      if (i === 0 && markFirstLevel && !edge.firstLevel) {
        edge.firstLevel = true
        edge.reviewKey = reviewKey(
          row.userId,
          heldKind,
          row.accessItemId,
          row.accessItemName ?? '',
        )
      }
    }
  }

  return withAttributeEntitlementCounts({
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  })
}
