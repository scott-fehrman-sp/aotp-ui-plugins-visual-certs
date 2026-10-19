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
} from '../sailpoint/types'

/** One present level on a row's path: a graph node to add + edge to continue. */
interface Level {
  id: string
  kind: AccessGraphNodeKind
  label: string
  /** Extra tooltip detail for this node (department/location or description). */
  detail?: { description?: string; department?: string; location?: string }
}

/**
 * Builds a node's tooltip `detail` from the row, keeping only non-empty keys.
 * Returns `undefined` when there is nothing to show so a bare node stays
 * `{ id, kind, label }` (and the tooltip renders only kind + label).
 */
function detailFor(
  kind: AccessGraphNodeKind,
  row: AccessMatrixRowVM,
): Level['detail'] {
  const detail: { description?: string; department?: string; location?: string } = {}
  if (kind === 'user') {
    if (row.userDepartment) detail.department = row.userDepartment
    if (row.userLocation) detail.location = row.userLocation
  } else {
    const description =
      kind === 'role'
        ? row.roleDescription
        : kind === 'accessProfile'
          ? row.accessProfileDescription
          : kind === 'entitlement'
            ? row.entitlementDescription
            : row.sourceDescription
    if (description) detail.description = description
  }
  return Object.keys(detail).length > 0 ? detail : undefined
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
 *   user → (role?) → (accessProfile?) → entitlement → source
 * with absent (blank) levels SKIPPED so the chain always connects consecutive
 * present levels:
 *   - direct entitlement:        user → entitlement → source
 *   - AP grant:                  user → accessProfile → entitlement → source
 *   - role direct entitlement:   user → role → entitlement → source
 *   - role → AP → entitlement:   user → role → accessProfile → entitlement → source
 *
 * Node id scheme (namespaced so ids never collide across layers):
 *   - `user:<userId>`
 *   - `role:<roleId>`                 (fallback `role:name:<roleName>`)
 *   - `accessProfile:<accessProfileId>` (fallback `accessProfile:name:<apName>`)
 *   - `entitlement:<entitlementId>`   (fallback
 *     `entitlement:name:<sourceId|sourceName>:<entName>` — keeps same-named
 *     entitlements on different sources distinct even without ids)
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
      label: row.user,
      detail: detailFor('user', row),
    })

    // Role / access profile only when on this path (blank = skipped).
    if (row.role !== '') {
      levels.push({
        id: row.roleId ? `role:${row.roleId}` : `role:name:${row.role}`,
        kind: 'role',
        label: row.role,
        detail: detailFor('role', row),
      })
    }
    if (row.accessProfile !== '') {
      levels.push({
        id: row.accessProfileId
          ? `accessProfile:${row.accessProfileId}`
          : `accessProfile:name:${row.accessProfile}`,
        kind: 'accessProfile',
        label: row.accessProfile,
        detail: detailFor('accessProfile', row),
      })
    }

    // Entitlement + source are present on every real leaf row. They are blank
    // together only on the degenerate all-blank-leaf `access`-kind row, which
    // then contributes just the user node.
    if (row.entitlement !== '') {
      levels.push({
        id: row.entitlementId
          ? `entitlement:${row.entitlementId}`
          : entitlementFallbackId(row),
        kind: 'entitlement',
        label: row.entitlement,
        detail: detailFor('entitlement', row),
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

    // Add nodes, then one edge per consecutive present pair.
    for (const level of levels) addNode(level)
    for (let i = 0; i < levels.length - 1; i++) {
      const from = levels[i].id
      const to = levels[i + 1].id
      const key = `${from}|${to}`
      const existing = edges.get(key)
      if (existing) {
        existing.pathCount += 1
      } else {
        edges.set(key, { from, to, pathCount: 1 })
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  }
}
