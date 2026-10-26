/**
 * Pure extraction of a single user's access subgraph from the full derived
 * graph.
 *
 * `userSubgraph` runs a forward traversal (user → … → source) from one user
 * node over the directed `from→to` edges, collecting exactly the nodes that
 * user can reach and the edges traversed to reach them. Feeding the result to
 * `buildAccessScene` renders the drill-down view for that one user without ever
 * touching the other users' nodes/edges.
 *
 * Review status is derived HERE, per user: a node carries `reviewStatus` /
 * `reviewMixed` only when it is the target of THIS user's own `firstLevel`
 * edge, and the value is copied from that edge. The shared graph's nodes are
 * deduped across users, so any status they carried would leak between users;
 * every other kept node is returned without status (reference-only). Node and
 * edge status therefore cannot diverge.
 *
 * It is framework-pure: no React, no DOM, no I/O, no mutation of the input
 * graph, deterministic output. Output order mirrors the input graph's node and
 * edge order among the kept items, so identical input yields identical output.
 */
import type { AccessGraphData } from '../sailpoint/types'
import { withAttributeEntitlementCounts } from '../domain/attributeEntitlementCounts'

/**
 * Returns the forward-reachable subgraph rooted at `userNodeId`.
 *
 * - Unknown id (not a node in `graph`) → empty graph `{ nodes: [], edges: [] }`.
 * - A user with no outgoing edges → just that single user node, zero edges.
 * - Otherwise → the user node plus every node reachable by following `from→to`
 *   edges, and exactly the edges traversed along those paths.
 *
 * PURE and deterministic: does not mutate `graph` (status is stamped on COPIES of
 * the target nodes); kept nodes/edges preserve the input graph's relative order.
 */
export function userSubgraph(
  graph: AccessGraphData,
  userNodeId: string,
): AccessGraphData {
  const hasRoot = graph.nodes.some((node) => node.id === userNodeId)
  if (!hasRoot) {
    return { nodes: [], edges: [] }
  }

  // Index outgoing edges by their `from` id for an O(1) forward walk.
  const outgoing = new Map<string, typeof graph.edges>()
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.from)
    if (list) list.push(edge)
    else outgoing.set(edge.from, [edge])
  }

  const reachableNodeIds = new Set<string>([userNodeId])
  const keptEdgeKeys = new Set<string>()
  const queue: string[] = [userNodeId]

  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const edge of outgoing.get(current) ?? []) {
      keptEdgeKeys.add(`${edge.from}|${edge.to}`)
      if (!reachableNodeIds.has(edge.to)) {
        reachableNodeIds.add(edge.to)
        queue.push(edge.to)
      }
    }
  }

  const keptEdges = graph.edges.filter((edge) =>
    keptEdgeKeys.has(`${edge.from}|${edge.to}`),
  )

  // Status comes ONLY from this user's first-level edges.
  const edgeByTarget = new Map<string, (typeof graph.edges)[number]>()
  for (const edge of keptEdges) {
    if (edge.from === userNodeId && edge.firstLevel && edge.reviewStatus) {
      edgeByTarget.set(edge.to, edge)
    }
  }

  const keptNodes = graph.nodes
    .filter((node) => reachableNodeIds.has(node.id))
    .map((node) => {
      // Copy, then strip defensively so nothing but this user's edge can set it.
      const copy = { ...node }
      delete copy.reviewStatus
      delete copy.reviewMixed
      const edge = edgeByTarget.get(node.id)
      if (edge?.reviewStatus) {
        copy.reviewStatus = edge.reviewStatus
        copy.reviewMixed = edge.reviewMixed
      }
      return copy
    })

  // Attribute nodes are shared in the full graph, but only this user's
  // entitlement links were kept above. Recalculate the card count from those
  // visible links instead of retaining the full-graph count.
  return withAttributeEntitlementCounts({ nodes: keptNodes, edges: keptEdges })
}
